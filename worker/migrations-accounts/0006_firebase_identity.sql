-- The app account ID and all its credits/history remain unchanged.
-- Old development accounts are explicitly marked until an operator maps their
-- Google subjects to Firebase UIDs. Never silently treat a Google ID as a UID.
ALTER TABLE accounts RENAME COLUMN google_sub TO firebase_uid;
UPDATE accounts SET firebase_uid = 'legacy-google:' || firebase_uid;
