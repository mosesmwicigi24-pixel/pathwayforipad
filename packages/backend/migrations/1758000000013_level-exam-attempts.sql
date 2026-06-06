-- Migration 13 · Level exam attempts — supports §1.9 rule 2 (DEVIATION, flagged)
-- ============================================================================
-- §1.9 requires a level exam (passed at/above levels.required_exam_pass_mark)
-- before a member may submit the level reflection, but §2 defines no storage for
-- exam attempts (only per-module quiz_attempts). We add a level-scoped attempts
-- table mirroring quiz_attempts. Scored server-side (§1.3); idempotent on
-- client_mutation_id for offline replay (§1.7).
-- ============================================================================

-- Up Migration

CREATE TABLE level_exam_attempts (
  exam_attempt_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      UUID NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
  level_number       INT NOT NULL REFERENCES levels(level_number),
  score_achieved     NUMERIC(5,2) NOT NULL,
  is_passed          BOOLEAN NOT NULL,
  question_set       JSONB NOT NULL,                       -- the question_ids served
  client_mutation_id UUID UNIQUE,                          -- idempotent offline replay
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_level_exam_attempts_enrollment ON level_exam_attempts (enrollment_id, level_number);

-- Down Migration

DROP TABLE IF EXISTS level_exam_attempts;
