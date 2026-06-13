-- Migration 30 · Admin-set starting point (level + module)
-- ============================================================================
-- An admin placing a returning/mature member can set where their Pathway begins:
-- a starting LEVEL and the entry MODULE within it. These columns record that
-- placement so the gating engine can open the entry point on mobile.
--
--   start_level            — the level the member is placed at (current_level is
--                            set to this on placement; the §1.9 hard-lock ceiling
--                            still applies — nothing above current_level unlocks).
--   start_module_sequence  — the entry module's sequence within start_level.
--                            Modules at/before it in that level are treated as
--                            covered (open, not required for advancement); the
--                            entry module is the start point.
--
-- Defaults (1, 1) reproduce today's behaviour exactly: every member begins at
-- Level 1 · Module 1, which is always open.
-- ============================================================================

-- Up Migration

ALTER TABLE enrollments
  ADD COLUMN start_level INT NOT NULL DEFAULT 1 REFERENCES levels (level_number),
  ADD COLUMN start_module_sequence INT NOT NULL DEFAULT 1 CHECK (start_module_sequence >= 1);

-- Down Migration

ALTER TABLE enrollments DROP COLUMN IF EXISTS start_module_sequence;
ALTER TABLE enrollments DROP COLUMN IF EXISTS start_level;
