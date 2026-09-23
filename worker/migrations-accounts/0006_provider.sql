-- Which provider an account signed in with.
--
-- google_sub keeps its name but now holds whichever provider's subject claim
-- identified the person: Google's for an account made before this, Apple's for
-- one made with Sign in with Apple. The two namespaces do not collide, so the
-- UNIQUE on that column still does its job, and rebuilding the table to rename
-- a column would mean rebuilding everything that references it.
ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'google.com';
