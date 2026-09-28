// Every read and write of account and credit state goes through this module.
// Route handlers never touch D1 directly, so moving the ledger to another store
// later is a rewrite of this file rather than a hunt through handlers.

export interface Account {
  id: string;
  googleSub: string;
  email: string | null;
  stripeCustomerId: string | null;
}

export type CreditReason = "purchase" | "spend" | "refund" | "grant" | "reversal";

interface AccountRow {
  id: string;
  google_sub: string;
  email: string | null;
  stripe_customer_id: string | null;
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  googleSub: row.google_sub,
  email: row.email,
  stripeCustomerId: row.stripe_customer_id,
});

export async function getOrCreateAccount(db: D1Database, googleSub: string, email: string | null): Promise<Account> {
  const existing = await db.prepare(
    "SELECT id, google_sub, email, stripe_customer_id FROM accounts WHERE google_sub = ?",
  ).bind(googleSub).first<AccountRow>();
  if (existing) {
    // Providers do let people change their address; keep the latest one.
    if (email && email !== existing.email) {
      await db.prepare("UPDATE accounts SET email = ? WHERE id = ?").bind(email, existing.id).run();
      existing.email = email;
    }
    return toAccount(existing);
  }
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO accounts (id, google_sub, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(google_sub) DO NOTHING",
  ).bind(id, googleSub, email, Date.now()).run();
  const row = await db.prepare(
    "SELECT id, google_sub, email, stripe_customer_id FROM accounts WHERE google_sub = ?",
  ).bind(googleSub).first<AccountRow>();
  if (!row) throw new Error("Account row vanished immediately after insert");
  return toAccount(row);
}

export async function setStripeCustomerId(db: D1Database, accountId: string, customerId: string): Promise<void> {
  await db.prepare(
    "UPDATE accounts SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL",
  ).bind(customerId, accountId).run();
}

export async function creditBalance(db: D1Database, accountId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_entries WHERE account_id = ?",
  ).bind(accountId).first<{ balance: number }>();
  return row?.balance ?? 0;
}

/** Add credits. Idempotent on idempotencyKey: replaying a Stripe event is a
 *  no-op, and `applied` says which happened. */
export async function grantCredits(
  db: D1Database,
  input: { accountId: string; amount: number; reason: CreditReason; idempotencyKey: string },
): Promise<{ applied: boolean; balance: number }> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Credit amount must be a positive integer");
  const result = await db.prepare(
    `INSERT OR IGNORE INTO credit_entries (account_id, delta, reason, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(input.accountId, input.amount, input.reason, input.idempotencyKey, Date.now()).run();
  return { applied: (result.meta.changes ?? 0) > 0, balance: await creditBalance(db, input.accountId) };
}

/** Spend credits, refusing to go negative.
 *
 *  D1 has no interactive transactions, so the balance check and the insert are
 *  one statement: the INSERT ... SELECT ... WHERE only writes a row if the
 *  summed balance still covers the cost at write time. Two concurrent requests
 *  cannot both pass, which a read-then-write check would allow. */
export async function spendCredits(
  db: D1Database,
  input: { accountId: string; amount: number; idempotencyKey: string },
): Promise<{ applied: boolean; reason: "ok" | "insufficient" | "duplicate"; balance: number }> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Spend amount must be a positive integer");
  const duplicate = await db.prepare(
    "SELECT 1 FROM credit_entries WHERE idempotency_key = ?",
  ).bind(input.idempotencyKey).first();
  if (duplicate) return { applied: false, reason: "duplicate", balance: await creditBalance(db, input.accountId) };
  const result = await db.prepare(
    `INSERT INTO credit_entries (account_id, delta, reason, idempotency_key, created_at)
     SELECT ?1, ?2, 'spend', ?3, ?4
     WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_entries WHERE account_id = ?1) >= ?5`,
  ).bind(input.accountId, -input.amount, input.idempotencyKey, Date.now(), input.amount).run();
  const applied = (result.meta.changes ?? 0) > 0;
  return { applied, reason: applied ? "ok" : "insufficient", balance: await creditBalance(db, input.accountId) };
}

export interface PurchaseInput {
  accountId: string;
  packId: string;
  credits: number;
  amountCents: number;
  currency: string;
  stripeSessionId: string;
  stripePaymentIntent: string | null;
}

/** Record a completed Stripe purchase and credit it, as one atomic step.
 *
 *  The two writes go in a single D1 batch so there is no window in which money
 *  is recorded but uncredited (a customer who paid and got nothing) or credited
 *  but unrecorded (credits with no receipt behind them). Both inserts are
 *  OR IGNORE, so Stripe's webhook retries -- which are routine, not
 *  exceptional -- land as no-ops rather than a second grant. */
export async function recordPurchase(
  db: D1Database,
  input: PurchaseInput,
): Promise<{ applied: boolean; balance: number }> {
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) throw new Error("Purchase credits must be a positive integer");
  const idempotencyKey = `stripe:checkout:${input.stripeSessionId}`;
  const now = Date.now();
  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO purchases
         (stripe_session_id, stripe_payment_intent, account_id, pack_id, credits, amount_cents, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.stripeSessionId, input.stripePaymentIntent, input.accountId, input.packId,
      input.credits, input.amountCents, input.currency, now,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO credit_entries (account_id, delta, reason, idempotency_key, detail, created_at)
       VALUES (?, ?, 'purchase', ?, ?, ?)`,
    ).bind(input.accountId, input.credits, idempotencyKey, input.packId, now),
  ]);
  // The credit row is the one that decides: the purchase row may already exist
  // from a retry that failed midway, but the ledger is what the customer sees.
  const applied = (results[1]?.meta.changes ?? 0) > 0;
  return { applied, balance: await creditBalance(db, input.accountId) };
}

export interface ActivityEntry {
  id: number;
  delta: number;
  reason: CreditReason;
  detail: string | null;
  createdAt: number;
}

/** Newest-first ledger rows for the account page. */
export async function listActivity(db: D1Database, accountId: string, limit = 50): Promise<ActivityEntry[]> {
  const { results } = await db.prepare(
    `SELECT id, delta, reason, detail, created_at FROM credit_entries
     WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
  ).bind(accountId, Math.max(1, Math.min(limit, 200))).all<{
    id: number; delta: number; reason: CreditReason; detail: string | null; created_at: number;
  }>();
  return results.map(row => ({
    id: row.id, delta: row.delta, reason: row.reason, detail: row.detail, createdAt: row.created_at,
  }));
}

export interface StoredObject {
  key: string;
  mime: string;
  bytes: number;
}

export interface CloudJob {
  id: string;
  operation: string;
  priceKey: string;
  credits: number;
  status: "processing" | "succeeded" | "failed";
  outputUrl: string | null;
  originalKey: string | null;
  resultKey: string | null;
}

type StartJobResult =
  | { kind: "started"; job: CloudJob; balance: number }
  | { kind: "insufficient"; balance: number }
  | { kind: "duplicate"; job: CloudJob; balance: number };

interface CloudJobRow {
  id: string;
  operation: string;
  price_key: string;
  credits: number;
  status: CloudJob["status"];
  output_url: string | null;
  original_key: string | null;
  result_key: string | null;
}

const JOB_COLUMNS = "id, operation, price_key, credits, status, output_url, original_key, result_key";

const toJob = (row: CloudJobRow): CloudJob => ({
  id: row.id,
  operation: row.operation,
  priceKey: row.price_key,
  credits: row.credits,
  status: row.status,
  outputUrl: row.output_url,
  originalKey: row.original_key,
  resultKey: row.result_key,
});

async function findJob(db: D1Database, accountId: string, requestId: string): Promise<CloudJob | null> {
  const row = await db.prepare(
    `SELECT ${JOB_COLUMNS} FROM cloud_jobs WHERE account_id = ? AND request_id = ?`,
  ).bind(accountId, requestId).first<CloudJobRow>();
  return row ? toJob(row) : null;
}

/** Charge for a cloud operation and open its job, atomically.
 *
 *  Both statements run in one D1 batch, which is a transaction. The debit only
 *  writes if the balance covers the cost, and the job row only writes if that
 *  debit row now exists -- so "insufficient" leaves nothing behind. Two
 *  concurrent requests with the same request_id both pass the duplicate check,
 *  but the second batch trips UNIQUE(account_id, request_id) and rolls back
 *  whole, taking its debit with it. */
export async function startCloudJob(
  db: D1Database,
  input: { accountId: string; requestId: string; operation: string; options: string; priceKey: string; credits: number },
): Promise<StartJobResult> {
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) throw new Error("Job cost must be a positive integer");
  const existing = await findJob(db, input.accountId, input.requestId);
  if (existing) return { kind: "duplicate", job: existing, balance: await creditBalance(db, input.accountId) };

  const jobId = crypto.randomUUID();
  const spendKey = `spend:job:${jobId}`;
  const now = Date.now();
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        `INSERT INTO credit_entries (account_id, delta, reason, idempotency_key, detail, created_at)
         SELECT ?1, ?2, 'spend', ?3, ?4, ?5
         WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_entries WHERE account_id = ?1) >= ?6`,
      ).bind(input.accountId, -input.credits, spendKey, input.priceKey, now, input.credits),
      db.prepare(
        `INSERT INTO cloud_jobs (id, account_id, request_id, operation, options, price_key, credits, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing', ?8
         WHERE EXISTS (SELECT 1 FROM credit_entries WHERE idempotency_key = ?9)`,
      ).bind(jobId, input.accountId, input.requestId, input.operation, input.options, input.priceKey,
        input.credits, now, spendKey),
    ]);
  } catch (error) {
    const raced = await findJob(db, input.accountId, input.requestId);
    if (raced) return { kind: "duplicate", job: raced, balance: await creditBalance(db, input.accountId) };
    throw error;
  }
  const balance = await creditBalance(db, input.accountId);
  if ((results[0]?.meta.changes ?? 0) === 0) return { kind: "insufficient", balance };
  return {
    kind: "started",
    job: {
      id: jobId, operation: input.operation, priceKey: input.priceKey, credits: input.credits,
      status: "processing", outputUrl: null, originalKey: null, resultKey: null,
    },
    balance,
  };
}

/** Mark a job succeeded, with its history images when they were copied. */
export async function completeCloudJob(
  db: D1Database,
  jobId: string,
  input: { outputUrl: string; original: StoredObject | null; result: StoredObject | null },
): Promise<void> {
  await db.prepare(
    `UPDATE cloud_jobs
        SET status = 'succeeded', output_url = ?1,
            original_key = ?2, original_mime = ?3, original_bytes = ?4,
            result_key = ?5, result_mime = ?6, result_bytes = ?7, finished_at = ?8
      WHERE id = ?9 AND status = 'processing'`,
  ).bind(
    input.outputUrl,
    input.original?.key ?? null, input.original?.mime ?? null, input.original?.bytes ?? null,
    input.result?.key ?? null, input.result?.mime ?? null, input.result?.bytes ?? null,
    Date.now(), jobId,
  ).run();
}

/** Mark a job failed and give its credits back, once.
 *
 *  The refund is conditioned on the job actually being failed after the
 *  update, so a job that already succeeded is never refunded, and its
 *  idempotency key means a second failure report cannot refund twice. */
export async function failCloudJob(
  db: D1Database,
  job: { id: string; accountId: string; credits: number; priceKey: string },
  error: string,
): Promise<{ refunded: boolean; balance: number }> {
  const now = Date.now();
  const results = await db.batch([
    db.prepare(
      "UPDATE cloud_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'processing'",
    ).bind(error.slice(0, 500), now, job.id),
    db.prepare(
      `INSERT OR IGNORE INTO credit_entries (account_id, delta, reason, idempotency_key, detail, created_at)
       SELECT ?1, ?2, 'reversal', ?3, ?4, ?5
       WHERE EXISTS (SELECT 1 FROM cloud_jobs WHERE id = ?6 AND status = 'failed')`,
    ).bind(job.accountId, job.credits, `reversal:job:${job.id}`, job.priceKey, now, job.id),
  ]);
  return { refunded: (results[1]?.meta.changes ?? 0) > 0, balance: await creditBalance(db, job.accountId) };
}

/** Refund jobs stuck in processing past any request's lifetime.
 *
 *  A job only stays "processing" when its request died before finishing --
 *  usually the browser closed the connection, which cancels the worker along
 *  with its call to auralens. Without this, those credits would stay spent on a
 *  result nobody received. failCloudJob refunds at most once per job, so an
 *  overlapping run cannot double-refund. */
export async function refundStaleJobs(db: D1Database, startedBeforeMs: number, limit = 50): Promise<number> {
  const { results } = await db.prepare(
    `SELECT id, account_id, credits, price_key FROM cloud_jobs
      WHERE status = 'processing' AND created_at < ? ORDER BY created_at LIMIT ?`,
  ).bind(startedBeforeMs, limit).all<{ id: string; account_id: string; credits: number; price_key: string }>();
  let refunded = 0;
  for (const row of results) {
    const outcome = await failCloudJob(
      db, { id: row.id, accountId: row.account_id, credits: row.credits, priceKey: row.price_key },
      "stale: the request ended before the job finished",
    );
    if (outcome.refunded) refunded++;
  }
  return refunded;
}

/** Jobs still processing that started after `sinceMs`. Bounded by time so a
 *  job the worker never finished cannot block the account forever. */
export async function countActiveJobs(db: D1Database, accountId: string, sinceMs: number): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM cloud_jobs WHERE account_id = ? AND status = 'processing' AND created_at >= ?",
  ).bind(accountId, sinceMs).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Bytes the account's history currently occupies in the user-media bucket. */
export async function historyBytes(db: D1Database, accountId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(COALESCE(original_bytes, 0) + COALESCE(result_bytes, 0)), 0) AS n
       FROM cloud_jobs WHERE account_id = ? AND deleted_at IS NULL AND result_key IS NOT NULL`,
  ).bind(accountId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface HistoryItem {
  id: string;
  accountId: string;
  operation: string;
  options: Record<string, unknown>;
  priceKey: string;
  credits: number;
  createdAt: number;
  originalKey: string | null;
  originalMime: string | null;
  resultKey: string;
  resultMime: string;
  resultBytes: number;
  deletedAt: number | null;
}

interface HistoryRow {
  id: string; account_id: string; operation: string; options: string; price_key: string; credits: number;
  created_at: number; original_key: string | null; original_mime: string | null;
  result_key: string; result_mime: string; result_bytes: number; deleted_at: number | null;
}

const HISTORY_COLUMNS = `id, account_id, operation, options, price_key, credits, created_at, original_key,
  original_mime, result_key, result_mime, result_bytes, deleted_at`;

function toHistoryItem(row: HistoryRow): HistoryItem {
  let options: Record<string, unknown> = {};
  try {
    options = JSON.parse(row.options) as Record<string, unknown>;
  } catch { /* an unreadable options blob still lists; it just shows no settings */ }
  return {
    id: row.id, accountId: row.account_id, operation: row.operation, options, priceKey: row.price_key,
    credits: row.credits, createdAt: row.created_at, originalKey: row.original_key, originalMime: row.original_mime,
    resultKey: row.result_key, resultMime: row.result_mime, resultBytes: row.result_bytes, deletedAt: row.deleted_at,
  };
}

/** Newest-first saved results. Failed jobs and results that could not be
 *  copied into storage never appear. */
export async function listHistory(db: D1Database, accountId: string, limit = 100): Promise<HistoryItem[]> {
  const { results } = await db.prepare(
    `SELECT ${HISTORY_COLUMNS} FROM cloud_jobs
      WHERE account_id = ? AND status = 'succeeded' AND result_key IS NOT NULL AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(accountId, Math.max(1, Math.min(limit, 500))).all<HistoryRow>();
  return results.map(toHistoryItem);
}

/** One saved result by id, deleted or not -- the media route decides what a
 *  deleted item means. Not scoped to an account: its callers are either
 *  already account-scoped or authorised by a signed link. */
export async function getHistoryItem(db: D1Database, jobId: string): Promise<HistoryItem | null> {
  const row = await db.prepare(
    `SELECT ${HISTORY_COLUMNS} FROM cloud_jobs WHERE id = ? AND status = 'succeeded' AND result_key IS NOT NULL`,
  ).bind(jobId).first<HistoryRow>();
  return row ? toHistoryItem(row) : null;
}

/** Delete one of the account's saved results. Returns the storage keys to
 *  remove, or null when there is nothing of this account's to delete -- which
 *  covers another account's id as well as an unknown one, so callers cannot
 *  tell the two apart. The ledger row stays: the credits were spent. */
export async function deleteHistoryItem(
  db: D1Database,
  accountId: string,
  jobId: string,
): Promise<{ originalKey: string | null; resultKey: string } | null> {
  const row = await db.prepare(
    `SELECT original_key, result_key FROM cloud_jobs
      WHERE id = ? AND account_id = ? AND deleted_at IS NULL AND result_key IS NOT NULL`,
  ).bind(jobId, accountId).first<{ original_key: string | null; result_key: string }>();
  if (!row) return null;
  const result = await db.prepare(
    "UPDATE cloud_jobs SET deleted_at = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL",
  ).bind(Date.now(), jobId, accountId).run();
  if ((result.meta.changes ?? 0) === 0) return null;
  return { originalKey: row.original_key, resultKey: row.result_key };
}

export async function jobForAccount(db: D1Database, accountId: string, jobId: string): Promise<CloudJob | null> {
  const row = await db.prepare(
    `SELECT ${JOB_COLUMNS} FROM cloud_jobs WHERE id = ? AND account_id = ? AND deleted_at IS NULL`,
  ).bind(jobId, accountId).first<CloudJobRow>();
  return row ? toJob(row) : null;
}

/** Attach the images to a job that already succeeded: a tiled upscale is put
 *  back together in the browser, so its result arrives after the job does.
 *  Writes only while nothing is stored, so a repeated upload cannot orphan the
 *  objects already in the bucket. */
export async function attachHistoryMedia(
  db: D1Database,
  jobId: string,
  input: { original: StoredObject | null; result: StoredObject },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE cloud_jobs
        SET original_key = ?1, original_mime = ?2, original_bytes = ?3,
            result_key = ?4, result_mime = ?5, result_bytes = ?6
      WHERE id = ?7 AND status = 'succeeded' AND result_key IS NULL AND deleted_at IS NULL`,
  ).bind(
    input.original?.key ?? null, input.original?.mime ?? null, input.original?.bytes ?? null,
    input.result.key, input.result.mime, input.result.bytes, jobId,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

