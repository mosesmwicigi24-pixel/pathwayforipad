-- Seed · The four core funds (spec §2.6). Idempotent on the unique code.

INSERT INTO funds (code, name, is_active) VALUES
  ('tithe',   'Tithe',   TRUE),
  ('offering', 'Offering', TRUE),
  ('general', 'General Giving', TRUE),
  ('media',   'Media Purchases', TRUE)
ON CONFLICT (code) DO NOTHING;
