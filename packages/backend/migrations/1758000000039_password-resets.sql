-- Self-service password reset (§5.3, §5.5). A short-lived single-use token is
-- emailed to the account owner; we store only its SHA-256 hash so a DB leak can't
-- be replayed. Forward-only.
-- Up Migration
CREATE TABLE password_resets (
  reset_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL,                    -- sha256 hex of the raw token
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

-- Down Migration

DROP TABLE IF EXISTS password_resets;
