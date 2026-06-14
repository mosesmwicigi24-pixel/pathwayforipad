-- Migration 38 · Seed the giving funds shown in the mobile Give make.
-- ============================================================================
-- The Give tab offers five funds: Tithe, Offering, Gift, Mission, Discipleship.
-- Tithe/Offering already exist from the base seed; this makes Gift/Mission/
-- Discipleship real fund codes so a gift to any of them resolves (the giving
-- intent validates `fund` against funds.code, §3.5). Idempotent.
-- ============================================================================

-- Up Migration

INSERT INTO funds (code, name, is_active) VALUES
  ('tithe',        'Tithe',        TRUE),
  ('offering',     'Offering',     TRUE),
  ('gift',         'Gift',         TRUE),
  ('mission',      'Mission',      TRUE),
  ('discipleship', 'Discipleship', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Down Migration

DELETE FROM funds WHERE code IN ('gift', 'mission', 'discipleship');
