PRAGMA foreign_keys = ON;

-- Our own account record. The primary key is ours, not the identity
-- provider's: google_sub is a reference column, and the Firebase uid is not
-- stored at all. Leaving Firebase then means verifying Google's tokens
-- directly and matching on google_sub, with nothing else to migrate.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- Append-only ledger. The balance is SUM(delta), never a mutable column, so a
-- double credit or a lost debit shows up as a visible row rather than being
-- silently absorbed into a running total.
CREATE TABLE credit_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  delta INTEGER NOT NULL CHECK(delta <> 0),
  reason TEXT NOT NULL CHECK(reason IN ('purchase', 'spend', 'refund', 'grant', 'reversal')),
  -- One row per external cause. Stripe replays webhook events as a matter of
  -- course and clients retry jobs, so both must be no-ops rather than double
  -- counts. The UNIQUE constraint is what enforces that, not application code.
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX credit_entries_account ON credit_entries(account_id);
