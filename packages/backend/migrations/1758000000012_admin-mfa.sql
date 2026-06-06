-- Migration 12 · Admin step-up MFA (TOTP) — supports §5.3 (DEVIATION, flagged)
-- ============================================================================
-- §5.3 requires step-up MFA for SuperAdmin / financial-config actions, but the
-- §2 DDL defines no MFA storage. We add it to `users` (one factor per user):
--   • mfa_secret      — the TOTP shared secret, sealed with AES-256-GCM at the
--                       application layer (never stored in plaintext); see
--                       modules/identity/secretbox.ts.
--   • mfa_enabled     — set TRUE only after the first code is verified (so a
--                       half-finished enrollment can't gate a user out).
--   • mfa_enrolled_at — when the factor was confirmed.
-- The access token carries an `mfa` + `mfa_at` claim once verified; the
-- requireStepUp guard checks that claim's freshness on sensitive operations.
-- ============================================================================

-- Up Migration

ALTER TABLE users ADD COLUMN mfa_secret      VARCHAR(255);
ALTER TABLE users ADD COLUMN mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN mfa_enrolled_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS mfa_enrolled_at;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_secret;
