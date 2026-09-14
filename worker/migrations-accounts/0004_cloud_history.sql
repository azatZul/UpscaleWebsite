-- Cloud jobs take the iOS app's options, and successful results are kept as
-- the account's history until the user deletes them.
--
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt.
-- operation narrows to the two kinds; the exact priced variant (resolution,
-- restore mode, increased resolution) moves to price_key, and the full request
-- to options. Existing rows keep their old operation name as their price_key.
CREATE TABLE cloud_jobs_v2 (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('creative', 'restore')),
  options TEXT NOT NULL DEFAULT '{}',
  price_key TEXT NOT NULL DEFAULT '',
  credits INTEGER NOT NULL CHECK(credits > 0),
  status TEXT NOT NULL CHECK(status IN ('processing', 'succeeded', 'failed')),
  output_url TEXT,
  error TEXT,
  -- History: both images live in the private user-media bucket. Null when the
  -- copy failed, in which case the job still succeeded but is not in history.
  original_key TEXT,
  original_mime TEXT,
  original_bytes INTEGER,
  result_key TEXT,
  result_mime TEXT,
  result_bytes INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  deleted_at INTEGER,
  UNIQUE(account_id, request_id)
);

INSERT INTO cloud_jobs_v2 (id, account_id, request_id, operation, options, price_key, credits, status,
                           output_url, error, created_at, finished_at)
  SELECT id, account_id, request_id,
         CASE operation WHEN 'restore' THEN 'restore' ELSE 'creative' END,
         '{}', operation, credits, status, output_url, error, created_at, finished_at
    FROM cloud_jobs;

DROP TABLE cloud_jobs;
ALTER TABLE cloud_jobs_v2 RENAME TO cloud_jobs;

CREATE INDEX cloud_jobs_account ON cloud_jobs(account_id, created_at);
CREATE INDEX cloud_jobs_history ON cloud_jobs(account_id, deleted_at, created_at);
