-- Seed · The core funds (spec §2.6 + Contract Matrix B7 Give tab). Idempotent
-- on the unique code.

INSERT INTO funds (code, name, is_active) VALUES
  ('tithe',   'Tithe',   TRUE),
  ('offering', 'Offering', TRUE),
  ('general', 'General Giving', TRUE),
  ('media',   'Media Purchases', TRUE),
  ('mission', 'Missions', TRUE),
  ('gift',    'Gift', TRUE)
ON CONFLICT (code) DO NOTHING;
