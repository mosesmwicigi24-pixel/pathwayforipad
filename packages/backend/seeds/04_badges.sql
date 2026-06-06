-- Seed · Starter badge catalog (Features v2 §G). Faithfulness-framed milestones.
-- criteria use only REGISTERED rule kinds (module_count / level_reached /
-- streak_days / attendance_count) — never arbitrary expressions (§G.4).
-- Idempotent on the unique code.

INSERT INTO badges (code, name, description, category, criteria) VALUES
  ('first_module', 'First Steps',         'Completed your first module.',    'journey',     '{"kind":"module_count","count":1}'),
  ('modules_10',   'Ten Down',            'Completed ten modules.',          'journey',     '{"kind":"module_count","count":10}'),
  ('level_2',      'Level 2',             'Advanced to Level 2.',            'journey',     '{"kind":"level_reached","level":2}'),
  ('streak_7',     'Seven-Day Faithful',  'Active seven days in a row.',     'consistency', '{"kind":"streak_days","days":7}'),
  ('streak_30',    'Thirty-Day Faithful', 'Active thirty days in a row.',    'consistency', '{"kind":"streak_days","days":30}'),
  ('attend_4',     'Gathered',            'Checked in to four gatherings.',  'community',   '{"kind":"attendance_count","count":4}')
ON CONFLICT (code) DO NOTHING;
