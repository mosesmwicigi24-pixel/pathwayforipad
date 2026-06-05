-- Migration 00 · Extensions, enums & organisational structure (spec §2.2)
-- ============================================================================

-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search on names/curriculum
-- DEVIATION (flagged): the spec's §2.2 extensions block declares only pgcrypto
-- and pg_trgm, but users.email is typed CITEXT (§2 identity). citext must be
-- installed for that column to compile, so it is added here.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role        AS ENUM ('Student','Instructor','Admin','SuperAdmin');
CREATE TYPE question_type    AS ENUM ('MultipleChoice','TrueFalse','FillInTheBlank');
CREATE TYPE enrollment_state AS ENUM ('active','paused','completed','withdrawn');
CREATE TYPE review_state     AS ENUM ('pending','approved','rejected');
CREATE TYPE txn_status       AS ENUM ('requires_action','processing','succeeded','failed','refunded');
CREATE TYPE ledger_side      AS ENUM ('debit','credit');
CREATE TYPE notif_channel    AS ENUM ('push','email');
CREATE TYPE notif_status     AS ENUM ('scheduled','sent','failed','suppressed');
CREATE TYPE engagement_band  AS ENUM ('thriving','steady','watch','at_risk');
CREATE TYPE outbox_status    AS ENUM ('pending','processing','done','dead');

-- Congregations / branches (multi-tenant root for a global church)
CREATE TABLE congregations (
  congregation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  country         CHAR(2) NOT NULL,                       -- ISO 3166-1 alpha-2
  timezone        VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cell groups (normalises the PRD's home_cell_group varchar)
CREATE TABLE cell_groups (
  cell_group_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  name            VARCHAR(150) NOT NULL,
  leader_user_id  UUID,                                   -- FK added after users exists
  meeting_cadence INT NOT NULL DEFAULT 8,                 -- expected check-ins / 30d (Aᵢ baseline)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (congregation_id, name)
);

-- Down Migration

DROP TABLE IF EXISTS cell_groups;
DROP TABLE IF EXISTS congregations;
DROP TYPE IF EXISTS outbox_status;
DROP TYPE IF EXISTS engagement_band;
DROP TYPE IF EXISTS notif_status;
DROP TYPE IF EXISTS notif_channel;
DROP TYPE IF EXISTS ledger_side;
DROP TYPE IF EXISTS txn_status;
DROP TYPE IF EXISTS review_state;
DROP TYPE IF EXISTS enrollment_state;
DROP TYPE IF EXISTS question_type;
DROP TYPE IF EXISTS user_role;
