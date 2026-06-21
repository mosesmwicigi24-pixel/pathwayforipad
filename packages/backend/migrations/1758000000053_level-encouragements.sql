-- Migration 53 · Level encouragements (CMS-managed Pathway trail content)
-- ============================================================================
-- The mobile Pathway "module trail" interleaves motivational moments between
-- modules (a splash banner, a cheer, a sticker row, a short note). These were
-- fabricated client-side; this table makes them real, ordered, and editable from
-- the portal. Mentor / verse / announcement slots bind to their own live APIs;
-- this table covers the purely-motivational encouragement content.
--   after_module_sequence: render the row AFTER this module's sequence number
--     within the level (0 = before the first module).
--   kind: splash | cheer | sticker | note (presentation hint for the client).
-- ============================================================================

-- Up Migration

CREATE TABLE IF NOT EXISTS level_encouragements (
  encouragement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number          INT  NOT NULL,
  after_module_sequence INT  NOT NULL DEFAULT 0,
  kind                  TEXT NOT NULL DEFAULT 'splash',
  title                 TEXT,
  body                  TEXT,
  image_url             TEXT,
  scripture_ref         TEXT,
  emoji                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INT  NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_level_encouragements_level
  ON level_encouragements (level_number, after_module_sequence, sort_order)
  WHERE is_active = true;

-- Down Migration

DROP INDEX IF EXISTS idx_level_encouragements_level;
DROP TABLE IF EXISTS level_encouragements;
