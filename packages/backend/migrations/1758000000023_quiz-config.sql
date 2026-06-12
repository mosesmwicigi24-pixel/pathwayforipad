-- Migration 23 · Quiz config: time limit + attempts cap (Contract Matrix B4)
-- ============================================================================
-- The portal's Quiz Builder sets a time limit and an attempts cap per module.
-- Both are enforced SERVER-SIDE (§1.1): the limit clock starts when the quiz is
-- assembled (quiz_started_at on the progress row), and attempts are counted from
-- quiz_attempts — the client is never trusted with either.
-- ============================================================================

-- Up Migration

ALTER TABLE modules
  ADD COLUMN time_limit_sec INT CHECK (time_limit_sec IS NULL OR time_limit_sec BETWEEN 30 AND 7200),
  ADD COLUMN max_attempts   INT CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 50);

ALTER TABLE module_progress
  ADD COLUMN quiz_started_at TIMESTAMPTZ;          -- set at assemble; submit checks the window

-- Down Migration

ALTER TABLE module_progress DROP COLUMN IF EXISTS quiz_started_at;
ALTER TABLE modules
  DROP COLUMN IF EXISTS max_attempts,
  DROP COLUMN IF EXISTS time_limit_sec;
