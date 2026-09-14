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

export interface CloudJob {
  id: string;
  operation: string;
  credits: number;
  status: "processing" | "succeeded" | "failed";
  outputUrl: string | null;
}

type StartJobResult =
  | { kind: "started"; job: CloudJob; balance: number }
  | { kind: "insufficient"; balance: number }
  | { kind: "duplicate"; job: CloudJob; balance: number };

async function findJob(db: D1Database, accountId: string, requestId: string): Promise<CloudJob | null> {
  const row = await db.prepare(
    "SELECT id, operation, credits, status, output_url FROM cloud_jobs WHERE account_id = ? AND request_id = ?",
  ).bind(accountId, requestId).first<{
    id: string; operation: string; credits: number; status: CloudJob["status"]; output_url: string | null;
  }>();
  return row ? { id: row.id, operation: row.operation, credits: row.credits, status: row.status, outputUrl: row.output_url } : null;
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
  input: { accountId: string; requestId: string; operation: string; credits: number },
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
      ).bind(input.accountId, -input.credits, spendKey, input.operation, now, input.credits),
      db.prepare(
        `INSERT INTO cloud_jobs (id, account_id, request_id, operation, credits, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'processing', ?6
         WHERE EXISTS (SELECT 1 FROM credit_entries WHERE idempotency_key = ?7)`,
      ).bind(jobId, input.accountId, input.requestId, input.operation, input.credits, now, spendKey),
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
    job: { id: jobId, operation: input.operation, credits: input.credits, status: "processing", outputUrl: null },
    balance,
  };
}

export async function completeCloudJob(db: D1Database, jobId: string, outputUrl: string): Promise<void> {
  await db.prepare(
    "UPDATE cloud_jobs SET status = 'succeeded', output_url = ?, finished_at = ? WHERE id = ? AND status = 'processing'",
  ).bind(outputUrl, Date.now(), jobId).run();
}

/** Mark a job failed and give its credits back, once.
 *
 *  The refund is conditioned on the job actually being failed after the
 *  update, so a job that already succeeded is never refunded, and its
 *  idempotency key means a second failure report cannot refund twice. */
export async function failCloudJob(
  db: D1Database,
  job: { id: string; accountId: string; credits: number; operation: string },
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
    ).bind(job.accountId, job.credits, `reversal:job:${job.id}`, job.operation, now, job.id),
  ]);
  return { refunded: (results[1]?.meta.changes ?? 0) > 0, balance: await creditBalance(db, job.accountId) };
}
