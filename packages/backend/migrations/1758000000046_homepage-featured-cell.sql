-- Migration 46 · Homepage-featured cell ("This week at Nuru")
-- ============================================================================
-- The portal Cell Engagement page has a per-cell "Feature on homepage" toggle.
-- Exactly ONE cell may be featured at a time; the mobile home screen shows it as
-- "This week at Nuru". Mirrors the homepage welcome-video pattern (migration 44:
-- media_assets.is_homepage + a partial unique index for the single-row invariant).
-- ============================================================================

-- Up Migration

ALTER TABLE cell_groups
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- Only ONE cell may be featured on the homepage at a time. The partial unique
-- index enforces the single-row invariant (set is done in a tx that unsets others).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cell_groups_featured
  ON cell_groups ((is_featured)) WHERE is_featured = true;

-- Down Migration

DROP INDEX IF EXISTS uq_cell_groups_featured;
ALTER TABLE cell_groups
  DROP COLUMN IF EXISTS is_featured;
