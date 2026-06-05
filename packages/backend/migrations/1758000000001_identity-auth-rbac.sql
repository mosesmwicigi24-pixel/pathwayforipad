-- Migration 01 · Identity, auth & RBAC scoping (spec §2.2, tables 1–2)
-- ============================================================================

-- Up Migration

CREATE TABLE users (
  user_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT UNIQUE,                         -- nullable: SSO-only users may lack email
  password_hash     VARCHAR(255),                          -- nullable for pure-SSO accounts (argon2id)
  full_name         VARCHAR(255) NOT NULL,
  phone_number      VARCHAR(32) NOT NULL,
  date_of_birth     DATE NOT NULL,
  year_of_salvation INT,
  is_baptized       BOOLEAN NOT NULL DEFAULT FALSE,
  cell_group_id     UUID REFERENCES cell_groups(cell_group_id),
  congregation_id   UUID NOT NULL REFERENCES congregations(congregation_id),
  role              user_role NOT NULL DEFAULT 'Student',
  timezone          VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
  locale            VARCHAR(12) NOT NULL DEFAULT 'en',
  -- DEVIATION (flagged): the spec defines is_minor as a STORED generated column
  --   GENERATED ALWAYS AS (date_of_birth > CURRENT_DATE - INTERVAL '18 years') STORED
  -- PostgreSQL rejects this: generated-column expressions must be IMMUTABLE, and
  -- CURRENT_DATE is only STABLE. We keep is_minor as a plain BOOLEAN maintained by
  -- the trigger below (set on insert/update from date_of_birth). Trade-off: the
  -- flag can go stale on the member's 18th birthday until the next write; a nightly
  -- maintenance job (or computing minor-status at query time) keeps it correct.
  -- See README "Flagged spec deviations".
  is_minor          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION fn_set_is_minor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_minor := NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_is_minor
  BEFORE INSERT OR UPDATE OF date_of_birth ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_is_minor();

ALTER TABLE cell_groups
  ADD CONSTRAINT fk_cell_leader FOREIGN KEY (leader_user_id) REFERENCES users(user_id);

-- Federated identities (KingsChat / Google / Apple). One user, many providers.
CREATE TABLE oauth_identities (
  identity_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider     VARCHAR(40) NOT NULL,                       -- 'kingschat' | 'google' | 'apple'
  provider_sub VARCHAR(255) NOT NULL,                      -- subject id from the IdP
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_sub)
);

-- Refresh-token family for rotation + reuse detection (§5.3)
CREATE TABLE refresh_tokens (
  token_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  family_id  UUID NOT NULL,                                -- rotating chain
  token_hash VARCHAR(255) NOT NULL,                        -- sha-256 of the token, never the token
  device_id  UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Granular admin scoping: which multiplier oversees which cohort/cell.
CREATE TABLE leader_assignments (
  assignment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cell_group_id  UUID NOT NULL REFERENCES cell_groups(cell_group_id) ON DELETE CASCADE,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leader_user_id, cell_group_id)
);

-- Down Migration

DROP TABLE IF EXISTS leader_assignments;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS oauth_identities;
ALTER TABLE cell_groups DROP CONSTRAINT IF EXISTS fk_cell_leader;
DROP TRIGGER IF EXISTS trg_users_is_minor ON users;
DROP FUNCTION IF EXISTS fn_set_is_minor();
DROP TABLE IF EXISTS users;
