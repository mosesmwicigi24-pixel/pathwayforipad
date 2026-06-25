-- Member 2FA: one-time recovery codes (sha256-hashed) so a member who loses
-- their authenticator can still complete login / disable 2FA (§5.3). Stored as
-- an array of hex digests; codes are consumed (array_remove) on use.

-- Up Migration

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[] NOT NULL DEFAULT '{}';

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS mfa_recovery_codes;
