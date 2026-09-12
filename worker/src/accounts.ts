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
