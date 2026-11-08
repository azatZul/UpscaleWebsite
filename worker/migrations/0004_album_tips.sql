-- Tips on albums that are free to download.
--
-- One row per paid tip session, written by whichever of the webhook or the
-- buyer's return lands first. A record for reconciliation only: nothing reads
-- it to decide access, and a tip is never refunded automatically.
CREATE TABLE album_tips (
  session_id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  payment_intent TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents IN (200, 300, 500, 700, 1000)),
  currency TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK(livemode IN (0, 1)),
  received_at INTEGER NOT NULL
);

-- Refund and dispute webhooks find a tip by its payment.
CREATE UNIQUE INDEX album_tips_payment_intent ON album_tips(payment_intent);
