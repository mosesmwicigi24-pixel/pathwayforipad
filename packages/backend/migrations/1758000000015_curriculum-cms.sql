-- Migration 15 · Curriculum CMS reconciliation (Prompt 5, spec §2.2, §1.9)
-- ============================================================================
-- Reconciles the schema with the real PRD curriculum and makes the pathway
-- author-driven instead of file-seeded:
--   • SIX levels (level 6 added; titles set by the production seed).
--   • Module lifecycle: status enum draft|published|archived. is_published is
--     now a GENERATED column (= status='published') so every existing read keeps
--     working; writes go through `status` only.
--   • Authoring fields: summary, key_verses; optimistic-concurrency row_version +
--     updated_at (bumped by a BEFORE UPDATE trigger).
--   • evaluation_kind constrained to none|reflection|quiz|exit_exam (default
--     'quiz' preserves the prior "has questions ⇒ quiz" gating behavior).
--   • module_progress.reflection_text so a 'reflection' module can gate the next.
--   • levels.exam_question_count for level-exam configuration.
-- ============================================================================

-- Up Migration

-- 6th level for already-migrated databases (fresh DBs get all six from the seed).
INSERT INTO levels (level_number, title, theme, required_exam_pass_mark)
VALUES (6, 'Level 6', NULL, 80.00)
ON CONFLICT (level_number) DO NOTHING;

ALTER TABLE levels ADD COLUMN IF NOT EXISTS exam_question_count INT;

-- --- Module lifecycle: status enum + generated is_published ------------------
CREATE TYPE module_status AS ENUM ('draft', 'published', 'archived');

ALTER TABLE modules ADD COLUMN status module_status NOT NULL DEFAULT 'draft';
UPDATE modules SET status = CASE WHEN is_published THEN 'published'::module_status ELSE 'draft'::module_status END;

-- Replace the writable boolean with a generated mirror so all existing SQL that
-- reads is_published keeps working; the column can no longer be written directly.
ALTER TABLE modules DROP COLUMN is_published;
ALTER TABLE modules
  ADD COLUMN is_published BOOLEAN GENERATED ALWAYS AS (status = 'published') STORED;

-- --- Authoring fields --------------------------------------------------------
ALTER TABLE modules ADD COLUMN summary TEXT;
ALTER TABLE modules ADD COLUMN key_verses JSONB;
ALTER TABLE modules ADD COLUMN row_version INT NOT NULL DEFAULT 1;
ALTER TABLE modules ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE modules ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Optimistic-concurrency: bump row_version + updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION fn_touch_modules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_touch_modules BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION fn_touch_modules();

-- --- evaluation_kind constraint ---------------------------------------------
UPDATE modules SET evaluation_kind = 'quiz' WHERE evaluation_kind IS NULL;
UPDATE modules SET evaluation_kind = 'none'
  WHERE evaluation_kind NOT IN ('none', 'reflection', 'quiz', 'exit_exam');
ALTER TABLE modules ALTER COLUMN evaluation_kind SET DEFAULT 'quiz';
ALTER TABLE modules ALTER COLUMN evaluation_kind SET NOT NULL;
ALTER TABLE modules ADD CONSTRAINT modules_evaluation_kind_chk
  CHECK (evaluation_kind IN ('none', 'reflection', 'quiz', 'exit_exam'));

-- --- Per-module reflection (gates 'reflection' modules) ---------------------
ALTER TABLE module_progress ADD COLUMN reflection_text TEXT;

-- Down Migration

ALTER TABLE module_progress DROP COLUMN IF EXISTS reflection_text;

ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_evaluation_kind_chk;
ALTER TABLE modules ALTER COLUMN evaluation_kind DROP NOT NULL;
ALTER TABLE modules ALTER COLUMN evaluation_kind DROP DEFAULT;

DROP TRIGGER IF EXISTS trg_touch_modules ON modules;
DROP FUNCTION IF EXISTS fn_touch_modules();

ALTER TABLE modules DROP COLUMN IF EXISTS created_at;
ALTER TABLE modules DROP COLUMN IF EXISTS updated_at;
ALTER TABLE modules DROP COLUMN IF EXISTS row_version;
ALTER TABLE modules DROP COLUMN IF EXISTS key_verses;
ALTER TABLE modules DROP COLUMN IF EXISTS summary;

ALTER TABLE modules DROP COLUMN IF EXISTS is_published;
ALTER TABLE modules ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE modules SET is_published = (status = 'published');
ALTER TABLE modules DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS module_status;

ALTER TABLE levels DROP COLUMN IF EXISTS exam_question_count;
DELETE FROM levels WHERE level_number = 6;
