-- Migration 32 · Quiz Builder editorial metadata (Web Portal "Quiz Builder" make)
-- ============================================================================
-- The Quiz Builder authors per-question explanation + point weight, and a
-- per-module "shuffle questions" flag. These are authoring/presentation fields;
-- server-side scoring still keys off correct_answer + quiz_pass_mark (§1.9).
--
-- archived_at separates "draft" (is_active=FALSE, still visible in the builder)
-- from "deleted" (archived, hidden in the builder). Deletes stay soft so that
-- existing assessment attempts referencing the question keep their FK (§2). The
-- delete path also clears is_active, so every delivery/scoring query (which
-- already filters WHERE is_active) excludes archived questions with no change.
-- ============================================================================

-- Up Migration

ALTER TABLE question_bank
  ADD COLUMN explanation TEXT,
  ADD COLUMN points INT NOT NULL DEFAULT 1 CHECK (points >= 1),
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE modules
  ADD COLUMN quiz_shuffle BOOLEAN NOT NULL DEFAULT TRUE;

-- Down Migration

ALTER TABLE modules DROP COLUMN IF EXISTS quiz_shuffle;
ALTER TABLE question_bank DROP COLUMN IF EXISTS archived_at;
ALTER TABLE question_bank DROP COLUMN IF EXISTS points;
ALTER TABLE question_bank DROP COLUMN IF EXISTS explanation;
