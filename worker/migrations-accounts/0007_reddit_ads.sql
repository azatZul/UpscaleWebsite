-- Attribution is optional and independent of account / financial records.
CREATE TABLE reddit_contexts (
  id TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL DEFAULT 1,
  click_id TEXT,
  first_touch TEXT NOT NULL,
  last_touch TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  rate_started_at INTEGER NOT NULL,
  rate_count INTEGER NOT NULL DEFAULT 0
);
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
