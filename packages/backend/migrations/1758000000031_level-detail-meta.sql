-- Migration 31 · Level Detail editorial metadata (Web Portal "Level Detail" make)
-- ============================================================================
-- The Level Detail CMS page edits presentation/editorial metadata on each level
-- beyond the gating fields: an estimated duration label, an editorial lifecycle
-- status, a locked flag (visually gates the level in the portal tree), and an
-- accent colour used for the level band. None of these affect the §1.9 gating
-- engine (which keys off current_level + module completion) — they are CMS-only.
-- ============================================================================

-- Up Migration

ALTER TABLE levels
  ADD COLUMN duration VARCHAR(40),
  ADD COLUMN status   VARCHAR(12) NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'draft', 'in_review')),
  ADD COLUMN locked   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN color    VARCHAR(9) NOT NULL DEFAULT '#0B84E8';

-- Backfill a distinct accent colour per existing level (rotating palette).
UPDATE levels SET color = CASE (level_number - 1) % 6
  WHEN 0 THEN '#16A34A'  -- green
  WHEN 1 THEN '#0B84E8'  -- blue
  WHEN 2 THEN '#7C3AED'  -- violet
  WHEN 3 THEN '#C89B3C'  -- gold
  WHEN 4 THEN '#DC2626'  -- red
  ELSE        '#0F766E'  -- teal
END;

-- Down Migration

ALTER TABLE levels DROP COLUMN IF EXISTS color;
ALTER TABLE levels DROP COLUMN IF EXISTS locked;
ALTER TABLE levels DROP COLUMN IF EXISTS status;
ALTER TABLE levels DROP COLUMN IF EXISTS duration;
