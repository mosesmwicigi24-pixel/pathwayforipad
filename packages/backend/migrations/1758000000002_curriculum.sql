-- Migration 02 · Curriculum with versioning (spec §2.2, tables 3–4)
-- ============================================================================

-- Up Migration

CREATE TABLE levels (
  level_number            INT PRIMARY KEY,                 -- 1..5, fixed dimension
  title                   VARCHAR(255) NOT NULL,
  theme                   TEXT,
  required_exam_pass_mark NUMERIC(5,2) NOT NULL DEFAULT 80.00
);

CREATE TABLE modules (
  module_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number           INT NOT NULL REFERENCES levels(level_number),
  module_sequence_number INT NOT NULL,
  title                  VARCHAR(255) NOT NULL,
  lesson_content         TEXT NOT NULL,
  video_url              VARCHAR(512),
  evaluation_kind        VARCHAR(60),                      -- 'quiz' | 'attendance' | 'exit_exam' ...
  estimated_minutes      INT,
  quiz_pass_mark         NUMERIC(5,2) NOT NULL DEFAULT 70.00,
  is_published           BOOLEAN NOT NULL DEFAULT FALSE,
  current_version        INT NOT NULL DEFAULT 1,
  UNIQUE (level_number, module_sequence_number)
);

-- Immutable content history so editing curriculum never breaks past attempts.
CREATE TABLE module_versions (
  version_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id      UUID NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  lesson_content TEXT NOT NULL,
  edited_by      UUID REFERENCES users(user_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_id, version_number)
);

CREATE TABLE question_bank (
  question_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id         UUID NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  q_type            question_type NOT NULL,
  question_text     TEXT NOT NULL,
  answer_options    JSONB,                                 -- localized choice arrays
  correct_answer    TEXT NOT NULL,
  difficulty_rating INT NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Down Migration

DROP TABLE IF EXISTS question_bank;
DROP TABLE IF EXISTS module_versions;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS levels;
