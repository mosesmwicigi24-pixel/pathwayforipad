-- Migration 18 · Onboarding: resumable stepper, consent, placement (Features v2 §O)
-- ============================================================================
-- Evolves the single-shot intake into a server-held resumable stepper (a dropped
-- connection must not lose progress), enforces guardian consent for minors before
-- finalize (closes the v1 open question / §5.9), and gives the literacy quiz a home.
-- ============================================================================

-- Up Migration

CREATE TYPE onboarding_step AS ENUM
  ('profile', 'cell_selection', 'guardian_consent', 'literacy_quiz', 'notifications', 'done');

CREATE TABLE onboarding_sessions (
  user_id      UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_step onboarding_step NOT NULL DEFAULT 'profile',
  steps        JSONB NOT NULL DEFAULT '{}',   -- {step: {completed_at}}
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE guardian_consents (
  consent_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  guardian_name        VARCHAR(255) NOT NULL,
  guardian_contact     TEXT NOT NULL,                -- field-level encrypted (§5.5)
  relationship         VARCHAR(60) NOT NULL,
  consent_text_version VARCHAR(20) NOT NULL,
  granted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by          UUID REFERENCES users(user_id),
  revoked_at           TIMESTAMPTZ                   -- revocation halts processing (§5.9)
);
CREATE INDEX idx_guardian_consent_user ON guardian_consents (user_id) WHERE revoked_at IS NULL;

CREATE TABLE onboarding_assessments (
  assessment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind               VARCHAR(30) NOT NULL DEFAULT 'literacy',
  score              NUMERIC(5,2),
  result             JSONB,
  client_mutation_id UUID UNIQUE,
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Directory search (§O.3): trigram index on the cell name.
CREATE INDEX idx_cell_groups_name_trgm ON cell_groups USING gin (name gin_trgm_ops);

-- Down Migration

DROP INDEX IF EXISTS idx_cell_groups_name_trgm;
DROP TABLE IF EXISTS onboarding_assessments;
DROP INDEX IF EXISTS idx_guardian_consent_user;
DROP TABLE IF EXISTS guardian_consents;
DROP TABLE IF EXISTS onboarding_sessions;
DROP TYPE IF EXISTS onboarding_step;
