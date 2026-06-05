-- Migration 04 · Assessment & reflection review (spec §2.2, tables 7–8)
-- ============================================================================

-- Up Migration

CREATE TABLE quiz_attempts (
  attempt_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_id        UUID NOT NULL REFERENCES module_progress(progress_id) ON DELETE CASCADE,
  score_achieved     NUMERIC(5,2) NOT NULL,
  is_passed          BOOLEAN NOT NULL,
  question_set       JSONB NOT NULL,                       -- the randomized question_ids served
  client_mutation_id UUID UNIQUE,
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quiz_attempt_answers (
  answer_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   UUID NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES question_bank(question_id),
  given_answer TEXT NOT NULL,
  is_correct   BOOLEAN NOT NULL
);

CREATE TABLE reflection_reviews (
  review_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(user_id),
  level_number   INT NOT NULL REFERENCES levels(level_number),
  reflection_text TEXT NOT NULL,
  state          review_state NOT NULL DEFAULT 'pending',
  reviewed_by    UUID REFERENCES users(user_id),
  feedback_notes TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at    TIMESTAMPTZ,
  UNIQUE (user_id, level_number)
);

-- Down Migration

DROP TABLE IF EXISTS reflection_reviews;
DROP TABLE IF EXISTS quiz_attempt_answers;
DROP TABLE IF EXISTS quiz_attempts;
