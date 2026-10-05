// Paying to unlock an album, without an account.
//
// A visitor presses "Unlock", pays on Stripe Checkout, and the album opens for
// everyone with its link. Three rules keep that honest:
//
// * At most one payable session per album. An attempt is written to D1 before
//   Stripe is called, and a partial unique index allows one creating-or-open
//   attempt per album; an old session is closed in Stripe before a new one is
//   made.
// * A payment is decided once. The batch that records it also unlocks the album
//   or queues its refund, so a crash cannot lose either.
// * Live Worker, live money. STRIPE_MODE pins which Stripe mode this deployment
//   accepts, so test keys or a test-mode event can never unlock a production
//   album for free.

import {
  albumCheckoutBody, createCheckoutSessionFromBody, createRefund, expireCheckoutSession, isDefinitiveRefusal,
  retrieveCheckoutSession, retrieveRefund, type RefundResult, type StripeConfig,
} from "./stripe";

export const ALBUM_MIN_PRICE_CENTS = 50;
// Hand out a stored session only while the buyer still has time to pay it.
const REUSE_MARGIN_S = 5 * 60;
// An attempt this young may still be waiting for Stripe in another request.
const CREATING_GRACE_S = 30;
// Stripe keeps an idempotency key for 24 hours; past this, a retry could make a
// second session. Nobody ever received a URL for such an attempt, so it is
// safe to give up on it.
const CREATING_ABANDON_S = 23 * 60 * 60;
const MAX_REFUND_ATTEMPTS = 10;
const SESSION_ID = /^cs_(test|live)_\w+$/;

/** Every clean twin of a watermarked preview is in place, over `albums a`. */
export const MEDIA_READY_SQL = `(a.unlocked_cover_key IS NOT NULL
  AND (a.gallery_key IS NULL OR a.unlocked_gallery_key IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.album_id = a.id AND p.unlocked_after_key IS NULL))`;

/** The album may be sold now: locked, priced, and ready to show clean previews
 *  the moment it is paid for. */
export const SALE_READY_SQL = `(a.state = 'locked' AND a.currency = 'USD'
  AND a.price_cents >= ${ALBUM_MIN_PRICE_CENTS} AND ${MEDIA_READY_SQL})`;

export interface AlbumPaymentEnv {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_MODE?: string;
}

interface AlbumStripe {
  config: StripeConfig;
  livemode: boolean;
}

/** Stripe for album payments, or null when it is missing or its key is for the
 *  other mode than this deployment accepts. */
export function albumStripe(env: AlbumPaymentEnv): AlbumStripe | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  const keyMode = /^(sk|rk)_live_/.test(secretKey) ? "live" : /^(sk|rk)_test_/.test(secretKey) ? "test" : null;
  if (keyMode === null || keyMode !== env.STRIPE_MODE) {
    console.error(JSON.stringify({ event: "album_checkout_mode_mismatch", expected: env.STRIPE_MODE ?? null, key: keyMode }));
    return null;
  }
  return { config: { secretKey }, livemode: keyMode === "live" };
}

type AttemptStatus = "creating" | "open" | "paid" | "expired" | "failed";

interface Attempt {
  id: string;
  album_id: string;
  amount_cents: number;
  livemode: number;
  request_body: string;
  status: AttemptStatus;
  session_id: string | null;
  url: string | null;
  expires_at: number | null;
  attempts: number;
  created_at: number;
}

interface SaleAlbum {
  id: string;
  title: string;
  photo_count: number;
  price_cents: number;
  sale_ready: number;
}

export type CheckoutOutcome =
  | { kind: "stripe"; url: string }
  // Back to the album with a notice: why no checkout was opened, or that the
  // album has just been paid for.
  | { kind: "album"; notice?: "preparing" | "retry" | "failed" | "unavailable" | "paid" };

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function saleAlbum(db: D1Database, albumId: string): Promise<SaleAlbum | null> {
  return db.prepare(
    `SELECT a.id, a.title, a.photo_count, a.price_cents, ${SALE_READY_SQL} AS sale_ready
       FROM albums a WHERE a.id = ?1`,
  ).bind(albumId).first<SaleAlbum>();
}

async function activeAttempt(db: D1Database, albumId: string): Promise<Attempt | null> {
  return db.prepare(
    "SELECT * FROM checkouts WHERE album_id = ?1 AND status IN ('creating', 'open')",
  ).bind(albumId).first<Attempt>();
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown";
}

/** POST /gallery/:id/unlock: send the visitor to the one payable session for
 *  this album, creating it if there is none. */
export async function startAlbumCheckout(
  env: AlbumPaymentEnv,
  albumId: string,
  origin: string,
  now = nowSeconds(),
): Promise<CheckoutOutcome> {
  const stripe = albumStripe(env);
  if (!stripe) return { kind: "album", notice: "unavailable" };

  // Each pass either finishes or closes the attempt in its way; four passes
  // cover recovering a stale-priced attempt, closing it, and then losing the
  // insert race to a winner that is already settled.
  for (let pass = 0; pass < 4; pass++) {
    const album = await saleAlbum(env.DB, albumId);
    if (!album || !album.sale_ready) return { kind: "album" };

    const active = await activeAttempt(env.DB, albumId);
    if (active) {
      const outcome = await resolveActiveAttempt(env, stripe, active, album, now);
      if (outcome === "again") continue;
      if (outcome !== "closed") return outcome;
    }

    const id = crypto.randomUUID();
    const body = albumCheckoutBody({
      checkoutId: id,
      albumId,
      productName: `Unlock "${album.title}" (${album.photo_count} ${album.photo_count === 1 ? "photo" : "photos"})`,
      priceCents: album.price_cents,
      successUrl: `${origin}/gallery/${albumId}?checkout={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/gallery/${albumId}`,
    });
    const inserted = await env.DB.prepare(
      `INSERT INTO checkouts (id, album_id, amount_cents, currency, livemode, request_body, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'usd', ?4, ?5, 'creating', ?6, ?6)
       ON CONFLICT DO NOTHING`,
    ).bind(id, albumId, album.price_cents, stripe.livemode ? 1 : 0, body, now).run();
    // Another request holds the album's one active slot; look at it again.
    if (inserted.meta.changes !== 1) continue;
    return createSession(env, stripe, { id, request_body: body }, now);
  }
  return { kind: "album", notice: "retry" };
}

async function resolveActiveAttempt(
  env: AlbumPaymentEnv,
  stripe: AlbumStripe,
  attempt: Attempt,
  album: SaleAlbum,
  now: number,
): Promise<CheckoutOutcome | "closed" | "again"> {
  if (attempt.status === "open") {
    const current = attempt.amount_cents === album.price_cents
      && attempt.url !== null
      && attempt.expires_at !== null && attempt.expires_at > now + REUSE_MARGIN_S;
    if (current) return { kind: "stripe", url: attempt.url! };
    // Repriced, expiring, or already expired on its own: Stripe sends no event
    // we act on when a session lapses, so the row can still say open.
    const settled = await settleOpenAttempt(env, stripe, attempt, now);
    if (settled === "paid") return { kind: "album", notice: "paid" };
    if (settled === "uncertain") return { kind: "album", notice: "retry" };
    return "closed";
  }

  const age = now - attempt.created_at;
  if (age < CREATING_GRACE_S) return { kind: "album", notice: "preparing" };
  if (age >= CREATING_ABANDON_S) {
    await env.DB.prepare(
      "UPDATE checkouts SET status = 'failed', last_error = 'abandoned', updated_at = ?2 WHERE id = ?1 AND status = 'creating'",
    ).bind(attempt.id, now).run();
    console.warn(JSON.stringify({ event: "album_checkout_abandoned", checkoutId: attempt.id, albumId: attempt.album_id }));
    return "closed";
  }
  // The request that made this attempt died somewhere around its Stripe call.
  // Repeating it with the stored body and key returns the session Stripe may
  // already have made, or makes it now.
  const recovered = await createSession(env, stripe, attempt, now);
  // Repriced while it hung: never send the buyer to the old amount. The
  // attempt is open now, so the next pass expires it like any other.
  if (recovered.kind === "stripe" && attempt.amount_cents !== album.price_cents) return "again";
  return recovered;
}

async function createSession(
  env: AlbumPaymentEnv,
  stripe: AlbumStripe,
  attempt: Pick<Attempt, "id" | "request_body">,
  now: number,
): Promise<CheckoutOutcome> {
  await env.DB.prepare(
    "UPDATE checkouts SET attempts = attempts + 1, updated_at = ?2 WHERE id = ?1 AND status = 'creating'",
  ).bind(attempt.id, now).run();
  let session: { id: string; url: string; expiresAt: number | null };
  try {
    session = await createCheckoutSessionFromBody(stripe.config, attempt.request_body, `album-checkout:${attempt.id}`);
  } catch (error) {
    const definitive = isDefinitiveRefusal(error);
    await env.DB.prepare(
      `UPDATE checkouts SET status = CASE WHEN ?3 THEN 'failed' ELSE status END, last_error = ?2, updated_at = ?4
        WHERE id = ?1 AND status = 'creating'`,
    ).bind(attempt.id, errorDetail(error), definitive ? 1 : 0, now).run();
    console.error(JSON.stringify({ event: "album_checkout_failed", checkoutId: attempt.id, definitive, detail: errorDetail(error) }));
    return { kind: "album", notice: definitive ? "failed" : "retry" };
  }

  const opened = await env.DB.prepare(
    `UPDATE checkouts SET status = 'open', session_id = ?2, url = ?3, expires_at = ?4, last_error = NULL, updated_at = ?5
      WHERE id = ?1 AND status = 'creating'`,
  ).bind(attempt.id, session.id, session.url, session.expiresAt, now).run();
  if (opened.meta.changes === 1) return { kind: "stripe", url: session.url };

  // A concurrent recovery of the same attempt got there first; it holds the
  // same session, since both sent the same key.
  const row = await env.DB.prepare("SELECT status, session_id FROM checkouts WHERE id = ?1").bind(attempt.id).first<Attempt>();
  if (row?.status === "open" && row.session_id === session.id) return { kind: "stripe", url: session.url };
  return { kind: "album", notice: "retry" };
}

/** Close an open attempt according to what its session really is in Stripe:
 *  expired → closed; paid → confirmed; open → expired first. An answer Stripe
 *  does not give leaves the row open for the next request to try again. */
async function settleOpenAttempt(
  env: AlbumPaymentEnv,
  stripe: AlbumStripe,
  attempt: Attempt,
  now: number,
): Promise<"closed" | "paid" | "uncertain"> {
  const sessionId = attempt.session_id;
  if (!sessionId) return "uncertain";
  try {
    let session = await retrieveCheckoutSession(stripe.config, sessionId);
    if (session?.status === "open") {
      try {
        await expireCheckoutSession(stripe.config, sessionId);
        session = { ...session, status: "expired" };
      } catch {
        // Paid or lapsed between the two calls; ask again what it is now.
        session = await retrieveCheckoutSession(stripe.config, sessionId);
      }
    }
    if (session?.status === "expired") {
      await env.DB.prepare(
        "UPDATE checkouts SET status = 'expired', updated_at = ?2 WHERE id = ?1 AND status = 'open'",
      ).bind(attempt.id, now).run();
      return "closed";
    }
    if (session?.status === "complete") {
      const result = await confirmAlbumPayment(env, stripe, session, now);
      if (result.status === "unlocked" || result.status === "refund") return "paid";
      // Completed but not something we can honour: a human has to look, and
      // the album must not stay unsellable meanwhile.
      await env.DB.prepare(
        "UPDATE checkouts SET status = 'failed', last_error = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'open'",
      ).bind(attempt.id, `complete_but_${result.status}`, now).run();
      return "closed";
    }
    return "uncertain";
  } catch (error) {
    console.error(JSON.stringify({ event: "album_checkout_settle_failed", checkoutId: attempt.id, detail: errorDetail(error) }));
    return "uncertain";
  }
}

export type ConfirmResult =
  | { status: "unlocked" | "refund"; albumId: string }
  | { status: "ignored" | "unpaid" | "mismatch" };

/** Record a paid album session and act on it, exactly once.
 *
 *  One D1 batch -- a single transaction, run in order -- unlocks the album if
 *  it is still locked, records the payment with what it decided, and queues a
 *  refund when this payment was not the one that unlocked it (paid twice,
 *  unlocked by hand, or deleted). Replaying it changes nothing. */
export async function confirmAlbumPayment(
  env: AlbumPaymentEnv,
  stripe: AlbumStripe,
  session: any,
  now = nowSeconds(),
): Promise<ConfirmResult> {
  if (session?.metadata?.kind !== "album_unlock" || typeof session.id !== "string") return { status: "ignored" };
  const sessionId: string = session.id;
  const attempt = await env.DB.prepare("SELECT * FROM checkouts WHERE session_id = ?1").bind(sessionId).first<Attempt>();
  const mismatch = (reason: string): ConfirmResult => {
    console.error(JSON.stringify({ event: "album_payment_mismatch", sessionId, reason }));
    return { status: "mismatch" };
  };
  if (!attempt || attempt.album_id !== session.metadata.album_id) return mismatch("unknown_session");
  if (session.livemode !== stripe.livemode || (attempt.livemode === 1) !== stripe.livemode) return mismatch("livemode");
  if (session.payment_status !== "paid") return { status: "unpaid" };
  if (String(session.currency).toLowerCase() !== "usd" || session.amount_total !== attempt.amount_cents) {
    return mismatch("amount");
  }
  if (typeof session.payment_intent !== "string" || !session.payment_intent) return mismatch("no_payment_intent");

  const albumId = attempt.album_id;
  const paymentIntent: string = session.payment_intent;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE albums SET state = 'unlocked', unlocked_at = ?2, unlocked_payment_id = ?3
        WHERE id = ?1 AND state = 'locked'`,
    ).bind(albumId, now, sessionId),
    env.DB.prepare(
      `INSERT INTO payment_events (session_id, album_id, payment_intent, amount_cents, currency, livemode, outcome, received_at)
       SELECT ?1, a.id, ?2, ?3, 'usd', ?4, CASE WHEN a.unlocked_payment_id IS ?1 THEN 'unlocked' ELSE 'refund' END, ?5
         FROM albums a WHERE a.id = ?6
       ON CONFLICT (session_id) DO NOTHING`,
    ).bind(sessionId, paymentIntent, attempt.amount_cents, attempt.livemode, now, albumId),
    env.DB.prepare(
      `INSERT INTO refund_jobs (payment_intent, session_id, album_id, amount_cents, reason, status, created_at, updated_at)
       SELECT ?1, ?2, a.id, ?3, CASE WHEN a.state = 'deleted' THEN 'album_deleted' ELSE 'already_unlocked' END, 'pending', ?4, ?4
         FROM albums a WHERE a.id = ?5 AND a.unlocked_payment_id IS NOT ?2
       ON CONFLICT (payment_intent) DO NOTHING`,
    ).bind(paymentIntent, sessionId, attempt.amount_cents, now, albumId),
    env.DB.prepare(
      "UPDATE checkouts SET status = 'paid', updated_at = ?2 WHERE session_id = ?1 AND status != 'paid'",
    ).bind(sessionId, now),
  ]);

  const recorded = await env.DB.prepare(
    "SELECT outcome FROM payment_events WHERE session_id = ?1",
  ).bind(sessionId).first<{ outcome: "unlocked" | "refund" }>();
  const outcome = recorded?.outcome ?? "refund";
  console.log(JSON.stringify({ event: outcome === "unlocked" ? "album_unlocked_by_payment" : "album_payment_to_refund", albumId, sessionId }));
  if (outcome === "refund") {
    // Best effort: the queued row is already safe, and the cron retries it.
    const job = await env.DB.prepare("SELECT * FROM refund_jobs WHERE payment_intent = ?1").bind(paymentIntent).first<RefundJob>();
    if (job) await processRefundJob(env, stripe, job, now).catch(() => undefined);
  }
  return { status: outcome, albumId };
}

/** Stripe's webhook for an album session. 503 while album payments are not
 *  configured, so Stripe keeps the event until they are. */
export async function handleAlbumWebhook(env: AlbumPaymentEnv, event: any): Promise<{ status: number; body: unknown }> {
  const stripe = albumStripe(env);
  if (!stripe) return { status: 503, body: { error: "billing_unavailable" } };
  if (event?.livemode !== stripe.livemode) {
    console.error(JSON.stringify({ event: "album_webhook_mode_mismatch", eventId: event?.id ?? null }));
    return { status: 200, body: { received: true, ignored: "livemode" } };
  }
  const result = await confirmAlbumPayment(env, stripe, event.data?.object);
  return { status: 200, body: { received: true, album: result.status } };
}

/** Back from Stripe on the success URL: confirm right away instead of waiting
 *  for the webhook. Stripe is only asked about sessions we created for this
 *  album, so arbitrary ids in the URL cost nothing. */
export async function confirmCheckoutReturn(
  env: AlbumPaymentEnv,
  albumId: string,
  sessionId: string,
): Promise<"paid" | "refunded" | "pending" | "ignored"> {
  if (!SESSION_ID.test(sessionId)) return "ignored";
  const known = await env.DB.prepare(
    "SELECT status FROM checkouts WHERE session_id = ?1 AND album_id = ?2",
  ).bind(sessionId, albumId).first<{ status: AttemptStatus }>();
  if (!known) return "ignored";
  const recorded = await env.DB.prepare(
    "SELECT outcome FROM payment_events WHERE session_id = ?1",
  ).bind(sessionId).first<{ outcome: "unlocked" | "refund" }>();
  if (recorded) return recorded.outcome === "unlocked" ? "paid" : "refunded";

  const stripe = albumStripe(env);
  if (!stripe) return "pending";
  try {
    const session = await retrieveCheckoutSession(stripe.config, sessionId);
    const result = await confirmAlbumPayment(env, stripe, session);
    if (result.status === "unlocked") return "paid";
    if (result.status === "refund") return "refunded";
    return result.status === "unpaid" ? "pending" : "ignored";
  } catch (error) {
    console.error(JSON.stringify({ event: "album_checkout_return_failed", sessionId, detail: errorDetail(error) }));
    return "pending";
  }
}

interface RefundJob {
  payment_intent: string;
  session_id: string;
  album_id: string;
  reason: string;
  status: "pending" | "submitted" | "succeeded" | "failed";
  refund_id: string | null;
  attempts: number;
}

/** Move one refund forward: ask Stripe for it, then follow it until Stripe
 *  says it succeeded or failed. A refund Stripe accepted can still be pending,
 *  so "submitted" is not "done". */
async function processRefundJob(env: AlbumPaymentEnv, stripe: AlbumStripe, job: RefundJob, now: number): Promise<void> {
  let refund: RefundResult;
  try {
    refund = job.status === "submitted" && job.refund_id
      ? await retrieveRefund(stripe.config, job.refund_id)
      : await createRefund(stripe.config, { paymentIntent: job.payment_intent, reason: job.reason });
  } catch (error) {
    const attempts = job.attempts + 1;
    const giveUp = isDefinitiveRefusal(error) || attempts >= MAX_REFUND_ATTEMPTS;
    await env.DB.prepare(
      `UPDATE refund_jobs SET attempts = ?2, last_error = ?3, status = CASE WHEN ?4 THEN 'failed' ELSE status END, updated_at = ?5
        WHERE payment_intent = ?1 AND status IN ('pending', 'submitted')`,
    ).bind(job.payment_intent, attempts, errorDetail(error), giveUp ? 1 : 0, now).run();
    console.error(JSON.stringify({
      event: giveUp ? "album_refund_failed" : "album_refund_retry",
      paymentIntent: job.payment_intent, albumId: job.album_id, attempts, detail: errorDetail(error),
    }));
    return;
  }

  const status = refund.status === "succeeded" ? "succeeded"
    : refund.status === "failed" || refund.status === "canceled" ? "failed"
    : "submitted";
  await env.DB.prepare(
    `UPDATE refund_jobs SET status = ?2, refund_id = ?3, last_error = NULL, updated_at = ?4
      WHERE payment_intent = ?1 AND status IN ('pending', 'submitted')`,
  ).bind(job.payment_intent, status, refund.id, now).run();
  const log = { event: `album_refund_${status}`, paymentIntent: job.payment_intent, albumId: job.album_id, refundId: refund.id };
  if (status === "failed") console.error(JSON.stringify(log));
  else console.log(JSON.stringify(log));
}

/** Cron: push every unfinished album refund one step. */
export async function processRefundJobs(env: AlbumPaymentEnv, now = nowSeconds()): Promise<number> {
  const stripe = albumStripe(env);
  if (!stripe) return 0;
  const jobs = await env.DB.prepare(
    "SELECT * FROM refund_jobs WHERE status IN ('pending', 'submitted') ORDER BY updated_at LIMIT 25",
  ).all<RefundJob>();
  for (const job of jobs.results) await processRefundJob(env, stripe, job, now);
  return jobs.results.length;
}

/** For the refund and dispute webhooks: whether a payment was an album unlock. */
export async function albumForPayment(env: AlbumPaymentEnv, paymentIntent: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT album_id FROM payment_events WHERE payment_intent = ?1",
  ).bind(paymentIntent).first<{ album_id: string }>();
  return row?.album_id ?? null;
}
