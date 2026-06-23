-- Spiritual-gifts assessment v2: a larger question bank, per-user served subsets
-- (shuffled, behaviour/AI-weighted), persisted raw answers, and personality-style
-- gift personas. Scoring moves from "the whole bank" to "the served subset", so
-- the served question ids MUST be persisted per draw to compute the right
-- denominator at submit time. §1.1 server-authoritative; offline-safe.

-- Up Migration

-- Personality-style persona copy per gift (member-facing results).
CREATE TABLE gift_definitions (
  gift_key     VARCHAR(40) PRIMARY KEY,
  title        VARCHAR(80)  NOT NULL,          -- e.g. "Leadership"
  persona_name VARCHAR(80)  NOT NULL,          -- e.g. "The Shepherd-Leader"
  tagline      VARCHAR(200),                   -- one-line personality hook
  summary      TEXT         NOT NULL,          -- the personality paragraph
  strengths    TEXT[]       NOT NULL DEFAULT '{}',
  serving      TEXT[]       NOT NULL DEFAULT '{}',
  emoji        VARCHAR(8),
  color        VARCHAR(9),
  sort         INT          NOT NULL DEFAULT 0
);

-- A drawn set of questions served to one member (the 20-of-50 subset). Scoring
-- uses exactly this set; weights + ai flag are kept for explainability.
CREATE TABLE gift_question_sets (
  set_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_ids            UUID[] NOT NULL,
  weights                 JSONB,               -- gift_key -> weight used to bias the draw
  ai_influenced           BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_assessment_id UUID,                -- set once consumed by a submission
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gift_sets_user_open ON gift_question_sets (user_id, created_at DESC);

-- Raw per-question answers (feeds persona analysis + history).
CREATE TABLE gift_answers (
  assessment_id UUID NOT NULL REFERENCES gift_assessments(assessment_id) ON DELETE CASCADE,
  question_id   UUID NOT NULL,
  value         SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 5),
  PRIMARY KEY (assessment_id, question_id)
);

ALTER TABLE gift_assessments ADD COLUMN set_id          UUID;
ALTER TABLE gift_assessments ADD COLUMN persona_summary TEXT;   -- personalized narrative across top gifts

-- Down Migration

ALTER TABLE gift_assessments DROP COLUMN IF EXISTS persona_summary;
ALTER TABLE gift_assessments DROP COLUMN IF EXISTS set_id;
DROP TABLE IF EXISTS gift_answers;
DROP TABLE IF EXISTS gift_question_sets;
DROP TABLE IF EXISTS gift_definitions;
