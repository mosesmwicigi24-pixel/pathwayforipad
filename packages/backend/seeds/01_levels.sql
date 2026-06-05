-- Seed · The five fixed levels (spec §2.6). Themes/titles are placeholders until
-- the PRD curriculum appendix is supplied; pass marks default per §1.9 (80%).
-- Idempotent: re-running does not duplicate or clobber edited titles.

INSERT INTO levels (level_number, title, theme, required_exam_pass_mark) VALUES
  (1, 'Level 1', 'Foundations',  80.00),
  (2, 'Level 2', 'Growth',       80.00),
  (3, 'Level 3', 'Service',      80.00),
  (4, 'Level 4', 'Leadership',   80.00),
  (5, 'Level 5', 'Multiplication', 80.00)
ON CONFLICT (level_number) DO NOTHING;
