-- Brute-force / credential-stuffing defense (§5.3). Track consecutive failed
-- password logins and temporarily lock an account after too many. Forward-only.
-- Up Migration
ALTER TABLE users
  ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN locked_until       TIMESTAMPTZ;

-- Down Migration
ALTER TABLE users
  DROP COLUMN IF EXISTS failed_login_count,
  DROP COLUMN IF EXISTS locked_until;
