-- Migration 43 · Quiz/question model expansion (Figma "ModuleQuizBuilder") — backend only
-- ============================================================================
-- The Figma quiz builder (ModuleQuizBuilder.tsx) supports SIX question types for
-- both per-module quizzes and per-level final assessments:
--   multiple_choice | checkbox | dropdown | short_answer | paragraph | linear_scale
-- The live model only had the legacy enum question_type
-- ('MultipleChoice','TrueFalse','FillInTheBlank'). We expand it backward-compatibly.
--
-- DESIGN FORK — enum vs CHECK-text (documented choice):
--   `ALTER TYPE question_type ADD VALUE` is not safely transactional under
--   node-pg-migrate's per-migration transaction (a value added in a txn cannot
--   also be USED in the same txn on some setups), and would leave the enum with a
--   mix of PascalCase legacy + snake_case Figma values. We instead take the SAFE,
--   fully-transactional, fully-reversible route the spec hint suggests: convert
--   question_bank.q_type from the enum to TEXT guarded by a CHECK constraint that
--   accepts BOTH the 3 legacy values (so existing seeds/tests/attempts keep
--   working) AND the 6 Figma values. The question_type enum itself is left in
--   place (it is harmless and migration 00's down still drops it once this
--   migration's own down has restored the column to that type).
--
-- ENCODING — folded into existing JSON columns (no rigid per-type columns):
--   • answer_options (JSONB) carries, for the NEW types, a structured object:
--       { "choices": [ { "id": "...", "text": "...", "is_correct": true|false }, ... ],
--         "scale":   { "min": 1, "max": 5, "min_label": "...", "max_label": "..." } }
--     Legacy rows keep their plain JSON string-array shape; the scoring/delivery
--     code reads whichever shape is present. choices[].is_correct expresses
--     multi-correct (checkbox) AND single-correct (multiple_choice/dropdown).
--   • correct_answer (TEXT) stays the scalar source of truth for auto-scoring:
--       - single-select (multiple_choice/dropdown/legacy MC/TrueFalse): the one
--         correct option text.
--       - checkbox (multi-correct): a JSON array of the correct option texts,
--         e.g. '["A","C"]'. Scoring parses it as a SET (all-or-nothing match).
--       - short_answer/FillInTheBlank: the correct free-text answer, or '' for
--         "no key provided → manual review".
--       - paragraph: always '' (manual review, never auto-graded).
--       - linear_scale: '' (collected only; points awarded if answered).
--     correct_answer stays NOT NULL; '' is the documented "manual / not-keyed"
--     sentinel for paragraph/keyless-short_answer/linear_scale.
--
-- Per-quiz reveal settings live where the other quiz config lives (modules):
--   quiz_show_answers / quiz_show_score. Levels carry the per-exam equivalents.
-- ============================================================================

-- Up Migration

-- 1) q_type enum → CHECK-constrained TEXT accepting legacy + the 6 Figma types.
ALTER TABLE question_bank
  ALTER COLUMN q_type TYPE TEXT USING q_type::text;

ALTER TABLE question_bank
  ADD CONSTRAINT question_bank_q_type_chk CHECK (q_type IN (
    -- legacy (kept valid so existing data/tests never break)
    'MultipleChoice', 'TrueFalse', 'FillInTheBlank',
    -- Figma ModuleQuizBuilder types
    'multiple_choice', 'checkbox', 'dropdown', 'short_answer', 'paragraph', 'linear_scale'
  ));

-- 2) Per-question authoring flag from the Figma builder: required (vs optional).
ALTER TABLE question_bank
  ADD COLUMN required BOOLEAN NOT NULL DEFAULT TRUE;

-- 3) Per-quiz reveal settings (Figma QuizSettings) on modules + levels.
ALTER TABLE modules
  ADD COLUMN quiz_show_answers BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN quiz_show_score   BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE levels
  ADD COLUMN exam_show_answers BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN exam_show_score   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN exam_shuffle      BOOLEAN NOT NULL DEFAULT TRUE;

-- Down Migration

ALTER TABLE levels
  DROP COLUMN IF EXISTS exam_shuffle,
  DROP COLUMN IF EXISTS exam_show_score,
  DROP COLUMN IF EXISTS exam_show_answers;

ALTER TABLE modules
  DROP COLUMN IF EXISTS quiz_show_score,
  DROP COLUMN IF EXISTS quiz_show_answers;

ALTER TABLE question_bank
  DROP COLUMN IF EXISTS required;

-- Restore q_type to the original enum. The USING cast only succeeds for rows
-- whose value is a legacy enum label; the reversibility check (CI: down→up) runs
-- against a DB with no Figma-typed question rows, so this is safe. Any rows
-- authored with the new types must be migrated/removed before reversing.
ALTER TABLE question_bank
  DROP CONSTRAINT IF EXISTS question_bank_q_type_chk;

ALTER TABLE question_bank
  ALTER COLUMN q_type TYPE question_type USING q_type::question_type;
