-- Migration 33 · System reference data: countries + languages
-- ============================================================================
-- First slice of the portal's new "System" section (Final Pathway Portal make).
-- Reference/lookup tables the Dashboard counts and the System pages (P4) manage.
-- Seeded inline (reference data) so counts are present in every environment.
-- Full RBAC (roles, permissions, users↔country/language) lands in a later phase.
-- ============================================================================

-- Up Migration

CREATE TABLE countries (
  code        VARCHAR(2) PRIMARY KEY,              -- ISO 3166-1 alpha-2
  name        TEXT NOT NULL,
  flag        TEXT,                                -- emoji flag
  region      TEXT,
  subregion   TEXT,
  dial_code   VARCHAR(8),
  currency    VARCHAR(3),                          -- ISO 4217
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE languages (
  code        VARCHAR(8) PRIMARY KEY,              -- ISO 639-1 (lowercase)
  name        TEXT NOT NULL,
  native_name TEXT NOT NULL,
  direction   VARCHAR(3) NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl')),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  coverage    INT NOT NULL DEFAULT 0 CHECK (coverage BETWEEN 0 AND 100),
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one default language.
CREATE UNIQUE INDEX languages_one_default ON languages (is_default) WHERE is_default;

-- Reference rows are seeded in seeds/07_system-reference.sql (re-applied by the
-- test resetDb and by `pnpm db:seed`).

-- Down Migration

DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS countries;
