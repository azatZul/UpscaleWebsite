// Tips on albums that are free to download.
//
// A visitor picks an amount, pays on Stripe Checkout, and comes back to a
// thank-you. Much simpler than an unlock, because a tip opens nothing:
//
// * No one-session-per-album rule. Every page render puts a fresh attempt id
//   in the form, and the Stripe idempotency key is built from it, so posting
//   the same form twice reuses one session while a deliberate second tip gets
//   its own.
// * A tip is recorded once, by whichever of the webhook or the buyer's return
//   arrives first; the other finds the row and does nothing.
// * Nothing is refunded automatically. A refund or dispute made in the Stripe
//   dashboard is only logged against the album.

import { albumStripe, type AlbumPaymentEnv, type CheckoutOutcome } from "./album-checkout";
import {
  albumTipBody, createCheckoutSessionFromBody, isDefinitiveRefusal, retrieveCheckoutSession,
} from "./stripe";

export const TIP_AMOUNTS_CENTS: readonly number[] = [200, 300, 500, 700, 1000];
export const DEFAULT_TIP_CENTS = 500;
const TIP_ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID = /^cs_(test|live)_\w+$/;

/** Free to download: opened by hand or published unlocked, never paid for. */
export const TIPPABLE_SQL = "(a.state = 'unlocked' AND a.unlocked_payment_id IS NULL)";

type AlbumStripe = NonNullable<ReturnType<typeof albumStripe>>;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown";
}

/** POST /gallery/:id/tip: send the visitor to Stripe for the amount they
 *  picked. A garbled form never reaches Stripe. */
export async function startAlbumTip(
  env: AlbumPaymentEnv,
  albumId: string,
  form: FormData | null,
  origin: string,
): Promise<CheckoutOutcome> {
  const amount = Number(form?.get("amount"));
  const attempt = form?.get("attempt");
  if (!TIP_AMOUNTS_CENTS.includes(amount) || typeof attempt !== "string" || !TIP_ATTEMPT.test(attempt)) {
    return { kind: "album", notice: "failed" };
  }
  const stripe = albumStripe(env);
  if (!stripe) return { kind: "album", notice: "unavailable" };

  const tippable = await env.DB.prepare(
    `SELECT 1 AS ok FROM albums a WHERE a.id = ?1 AND ${TIPPABLE_SQL}`,
  ).bind(albumId).first<{ ok: number }>();
  if (!tippable) return { kind: "album" };

  const body = albumTipBody({
    albumId,
    attempt,
    amountCents: amount,
    successUrl: `${origin}/gallery/${albumId}?tip={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/gallery/${albumId}`,
  });
  try {
    // The amount is part of the key: going back and picking another amount on
    // the same form is a different request, not a conflicting retry.
    const session = await createCheckoutSessionFromBody(stripe.config, body, `album-tip:${albumId}:${attempt}:${amount}`);
    return { kind: "stripe", url: session.url };
  } catch (error) {
    const definitive = isDefinitiveRefusal(error);
    console.error(JSON.stringify({ event: "album_tip_checkout_failed", albumId, definitive, detail: errorDetail(error) }));
    return { kind: "album", notice: definitive ? "failed" : "retry" };
  }
}

export type TipConfirmResult = "recorded" | "unpaid" | "ignored";

/** Record a paid tip session, once. Every field the row depends on is checked
 *  against what we would have created; anything else is logged and ignored. */
export async function confirmAlbumTip(
  env: AlbumPaymentEnv,
  stripe: AlbumStripe,
  session: any,
  now = nowSeconds(),
): Promise<TipConfirmResult> {
  if (session?.metadata?.kind !== "album_tip") return "ignored";
  const sessionId = typeof session.id === "string" ? session.id : null;
  const mismatch = (reason: string): TipConfirmResult => {
    console.error(JSON.stringify({ event: "album_tip_mismatch", sessionId, reason }));
    return "ignored";
  };
  if (!sessionId) return mismatch("no_session_id");
  if (session.mode !== "payment") return mismatch("mode");
  if (session.livemode !== stripe.livemode) return mismatch("livemode");
  const albumId = session.metadata.album_id;
  if (typeof albumId !== "string") return mismatch("no_album");
  const album = await env.DB.prepare("SELECT id FROM albums WHERE id = ?1").bind(albumId).first<{ id: string }>();
  if (!album) return mismatch("unknown_album");
  if (session.payment_status !== "paid") return "unpaid";
  if (String(session.currency).toLowerCase() !== "usd" || !TIP_AMOUNTS_CENTS.includes(session.amount_total)) {
    return mismatch("amount");
  }
  if (typeof session.payment_intent !== "string" || !session.payment_intent) return mismatch("no_payment_intent");

  const inserted = await env.DB.prepare(
    `INSERT INTO album_tips (session_id, album_id, payment_intent, amount_cents, currency, livemode, received_at)
     VALUES (?1, ?2, ?3, ?4, 'usd', ?5, ?6)
     ON CONFLICT DO NOTHING`,
  ).bind(sessionId, albumId, session.payment_intent, session.amount_total, stripe.livemode ? 1 : 0, now).run();
  // Logged by whichever of the webhook and the return wrote the row.
  if (inserted.meta.changes === 1) {
    console.log(JSON.stringify({ event: "album_tip_received", albumId, sessionId, amountCents: session.amount_total }));
  }
  return "recorded";
}

/** Stripe's webhook for a tip session. 503 while album payments are not
 *  configured, so Stripe keeps the event until they are. */
export async function handleAlbumTipWebhook(env: AlbumPaymentEnv, event: any): Promise<{ status: number; body: unknown }> {
  const stripe = albumStripe(env);
  if (!stripe) return { status: 503, body: { error: "billing_unavailable" } };
  if (event?.livemode !== stripe.livemode) {
    console.error(JSON.stringify({ event: "album_tip_webhook_mode_mismatch", eventId: event?.id ?? null }));
    return { status: 200, body: { received: true, ignored: "livemode" } };
  }
  const result = await confirmAlbumTip(env, stripe, event.data?.object);
  return { status: 200, body: { received: true, tip: result } };
}

export type TipReturn = "tipped" | "pending" | "ignored";

/** Back from Stripe with ?tip=: is this a confirmed tip on this album? A row
 *  already written answers without asking Stripe; otherwise the session is
 *  fetched and recorded now. Only a failure that may pass is "pending". */
export async function tipReturnStatus(env: AlbumPaymentEnv, albumId: string, sessionId: string): Promise<TipReturn> {
  if (!SESSION_ID.test(sessionId)) return "ignored";
  const known = await env.DB.prepare(
    "SELECT 1 AS ok FROM album_tips WHERE session_id = ?1 AND album_id = ?2",
  ).bind(sessionId, albumId).first<{ ok: number }>();
  if (known) return "tipped";

  const stripe = albumStripe(env);
  if (!stripe) return "pending";
  try {
    const session = await retrieveCheckoutSession(stripe.config, sessionId);
    if (session?.metadata?.kind !== "album_tip" || session.metadata.album_id !== albumId) return "ignored";
    const result = await confirmAlbumTip(env, stripe, session);
    return result === "recorded" ? "tipped" : result === "unpaid" ? "pending" : "ignored";
  } catch (error) {
    // A session Stripe says does not exist will not start existing.
    if (isDefinitiveRefusal(error)) return "ignored";
    console.error(JSON.stringify({ event: "album_tip_return_failed", sessionId, detail: errorDetail(error) }));
    return "pending";
  }
}

/** For the refund and dispute webhooks: the album a tip payment was for. */
export async function albumForTip(env: AlbumPaymentEnv, paymentIntent: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT album_id FROM album_tips WHERE payment_intent = ?1",
  ).bind(paymentIntent).first<{ album_id: string }>();
  return row?.album_id ?? null;
}
