-- Seed · The six discipleship levels (PRD curriculum — "DISCIPLESHIP CLASSES").
-- Titles are verbatim from the source course. Pass marks default per §1.9 (80%).
-- Idempotent: re-running does not duplicate or clobber edited titles.
-- NOTE (flagged deviation): the engineering spec assumed 5 levels / 45 modules;
-- the real PRD has 6 levels and ~51 modules, and curriculum size is data-driven.

INSERT INTO levels (level_number, title, theme, required_exam_pass_mark) VALUES
  (1, 'Foundations of Faith',                         'Foundations',    80.00),
  (2, 'Inner Transformation',                         'Transformation', 80.00),
  (3, 'Foundations of Grace & Kingdom Perspective',   'Grace',          80.00),
  (4, 'Life & Power of the Holy Spirit',              'Spirit',         80.00),
  (5, 'Kingdom Culture, Leadership & Multiplication', 'Leadership',     80.00),
  (6, 'Maturity, Platform, Multiplication & Legacy',  'Legacy',         80.00)
ON CONFLICT (level_number) DO NOTHING;
