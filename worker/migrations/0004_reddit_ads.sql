-- Album payments need their conversion committed atomically in this database.
-- Consent is checked against ACCOUNTS_DB.reddit_contexts before delivery.
CREATE TABLE reddit_checkouts (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE reddit_outbox (
  conversion_id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER,
  last_error TEXT
);
CREATE INDEX reddit_outbox_pending ON reddit_outbox(status, next_attempt_at, lease_until);
