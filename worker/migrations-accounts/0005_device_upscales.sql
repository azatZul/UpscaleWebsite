-- On-device upscales. The upscaling itself runs in the browser; this records
-- that one happened, so each account gets its free allowance and pays a credit
-- per upscale after that. free = 1 rows count against the allowance; paid rows
-- carry the credits charged, matched by a spend row in credit_entries.
-- request_id comes from the page, so a retried confirmation counts once.
CREATE TABLE device_upscales (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  free INTEGER NOT NULL CHECK(free IN (0, 1)),
  credits INTEGER NOT NULL CHECK(credits >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, request_id)
);
CREATE INDEX device_upscales_account ON device_upscales(account_id, free);
