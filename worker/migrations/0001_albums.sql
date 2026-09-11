PRAGMA foreign_keys = ON;

CREATE TABLE albums (
  id TEXT PRIMARY KEY CHECK(length(id) = 26),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  note TEXT CHECK(note IS NULL OR length(note) <= 2000),
  state TEXT NOT NULL CHECK(state IN ('locked', 'unlocked', 'deleted')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
  photo_count INTEGER NOT NULL CHECK(photo_count BETWEEN 1 AND 20),
  cover_photo_id TEXT NOT NULL,
  cover_key TEXT NOT NULL,
  cover_mime TEXT NOT NULL DEFAULT 'image/jpeg',
  cover_width INTEGER NOT NULL DEFAULT 1200,
  cover_height INTEGER NOT NULL DEFAULT 630,
  cover_bytes INTEGER NOT NULL,
  zip_key TEXT,
  zip_bytes INTEGER,
  source_url TEXT,
  created_at INTEGER NOT NULL,
  unlocked_at INTEGER,
  deleted_at INTEGER,
  expires_at INTEGER
);

CREATE TABLE photos (
  album_id TEXT NOT NULL REFERENCES albums(id),
  id TEXT NOT NULL CHECK(length(id) = 26),
  position INTEGER NOT NULL CHECK(position >= 0),
  before_key TEXT NOT NULL,
  before_width INTEGER NOT NULL,
  before_height INTEGER NOT NULL,
  before_bytes INTEGER NOT NULL,
  before_sha256 TEXT NOT NULL,
  after_key TEXT NOT NULL,
  after_width INTEGER NOT NULL,
  after_height INTEGER NOT NULL,
  after_bytes INTEGER NOT NULL,
  after_sha256 TEXT NOT NULL,
  clean_key TEXT NOT NULL,
  clean_width INTEGER NOT NULL,
  clean_height INTEGER NOT NULL,
  clean_bytes INTEGER NOT NULL,
  clean_mime TEXT NOT NULL,
  clean_sha256 TEXT NOT NULL,
  alt TEXT NOT NULL CHECK(length(alt) BETWEEN 1 AND 300),
  PRIMARY KEY (album_id, id),
  UNIQUE (album_id, position)
);

CREATE INDEX albums_featured_created_idx
  ON albums(featured, state, created_at DESC);
CREATE INDEX photos_album_position_idx
  ON photos(album_id, position);

CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  UNIQUE(provider, external_id)
);

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(provider, external_id)
);

CREATE TABLE refund_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_payment_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, external_payment_id)
);
