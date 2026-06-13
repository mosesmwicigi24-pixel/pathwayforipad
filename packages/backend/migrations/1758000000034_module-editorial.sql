-- Migration 34 · Module editorial metadata (Level Detail editor, Final Pathway make)
-- ============================================================================
-- The Level Detail module editor authors difficulty, learning objectives, tags,
-- visibility and a "required to advance" flag. Presentation/authoring fields —
-- gating/scoring stay server-authoritative on evaluation_kind + quiz_pass_mark
-- (§1.9). Key scripture maps to the existing key_verses; video to media_asset_id.
-- ============================================================================

-- Up Migration

ALTER TABLE modules
  ADD COLUMN difficulty  VARCHAR(12) NOT NULL DEFAULT 'beginner'
    CHECK (difficulty IN ('beginner','intermediate','advanced')),
  ADD COLUMN objectives  TEXT,
  ADD COLUMN tags        TEXT,
  ADD COLUMN visibility  VARCHAR(10) NOT NULL DEFAULT 'members'
    CHECK (visibility IN ('members','leaders','public')),
  ADD COLUMN required     BOOLEAN NOT NULL DEFAULT TRUE;

-- Down Migration

ALTER TABLE modules DROP COLUMN IF EXISTS required;
ALTER TABLE modules DROP COLUMN IF EXISTS visibility;
ALTER TABLE modules DROP COLUMN IF EXISTS tags;
ALTER TABLE modules DROP COLUMN IF EXISTS objectives;
ALTER TABLE modules DROP COLUMN IF EXISTS difficulty;
