-- What each ledger row was for, for the account page's activity list: the
-- purchase tier for purchases, the operation for spends and their reversals.
-- Nullable so existing rows stay valid.
ALTER TABLE credit_entries ADD COLUMN detail TEXT;

-- One row per paid cloud operation. The debit and this row are written in the
-- same batch, so a charge without a job (or a job nobody paid for) cannot
-- exist. request_id is chosen by the client, which makes a retried upload --
-- a double click, a flaky connection -- charge once.
CREATE TABLE cloud_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upscale_standard','restore','upscale_ultimate')),
  credits INTEGER NOT NULL CHECK(credits > 0),
  status TEXT NOT NULL CHECK(status IN ('processing','succeeded','failed')),
  output_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(account_id, request_id)
);
CREATE INDEX cloud_jobs_account ON cloud_jobs(account_id, created_at);
