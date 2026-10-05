-- Paid album unlocks.
--
-- 0001 reserved checkouts, payment_events and refund_jobs for this stage, but
-- nothing ever wrote to them, and their shape cannot hold an attempt before
-- Stripe has answered (external_id NOT NULL). Check both remote databases still
-- report zero rows in all three before applying:
--   SELECT (SELECT COUNT(*) FROM checkouts), (SELECT COUNT(*) FROM payment_events),
--          (SELECT COUNT(*) FROM refund_jobs);
DROP TABLE checkouts;
DROP TABLE payment_events;
DROP TABLE refund_jobs;

-- One row per attempt to start a checkout. The attempt id is the Stripe
-- idempotency key and request_body is the exact form body sent, so a retry after
-- a crash repeats the original request byte for byte.
CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 50),
  currency TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK(livemode IN (0, 1)),
  request_body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('creating', 'open', 'paid', 'expired', 'failed')),
  session_id TEXT UNIQUE,
  url TEXT,
  expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- At most one attempt per album may be payable or about to be.
CREATE UNIQUE INDEX checkouts_one_active ON checkouts(album_id) WHERE status IN ('creating', 'open');

-- One row per paid session, written in the same batch that decides whether the
-- payment unlocked the album or has to be refunded.
CREATE TABLE payment_events (
  session_id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  payment_intent TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK(livemode IN (0, 1)),
  outcome TEXT NOT NULL CHECK(outcome IN ('unlocked', 'refund')),
  received_at INTEGER NOT NULL
);

CREATE TABLE refund_jobs (
  payment_intent TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'submitted', 'succeeded', 'failed')),
  refund_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX refund_jobs_open_idx ON refund_jobs(status) WHERE status IN ('pending', 'submitted');

-- The session whose payment unlocked the album; NULL for a manual unlock.
ALTER TABLE albums ADD COLUMN unlocked_payment_id TEXT;

-- Clean twins of the watermarked previews, prepared at publish time so a paid
-- unlock can show them at once. Same dimensions as the watermarked versions.
ALTER TABLE albums ADD COLUMN unlocked_cover_key TEXT;
ALTER TABLE albums ADD COLUMN unlocked_cover_bytes INTEGER;
ALTER TABLE albums ADD COLUMN unlocked_gallery_key TEXT;
ALTER TABLE albums ADD COLUMN unlocked_gallery_bytes INTEGER;
ALTER TABLE photos ADD COLUMN unlocked_after_key TEXT;
ALTER TABLE photos ADD COLUMN unlocked_after_bytes INTEGER;
ALTER TABLE photos ADD COLUMN unlocked_after_sha256 TEXT;
