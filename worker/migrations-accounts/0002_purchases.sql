-- What was actually paid, separate from what was credited.
--
-- The ledger says a balance went up; this says a specific Stripe session, for a
-- specific amount in a specific currency, is why. Keeping both means money can
-- be reconciled against Stripe's own records without inferring dollars from
-- credit deltas, and a later refund can find its original purchase.
CREATE TABLE purchases (
  stripe_session_id TEXT PRIMARY KEY,
  stripe_payment_intent TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  pack_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits > 0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX purchases_account ON purchases(account_id);
