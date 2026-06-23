-- Per-day personalized Home greeting (Nuru LLM micro-copy). Generated once per
-- member per EAT day and cached here, so the model is called at most once/day/user
-- (cost control) and the line is stable through the day. Pure presentation copy —
-- no doctrine/structure decisions, server-authoritative (§1.1).

-- Up Migration

CREATE TABLE home_greetings (
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_date   DATE NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_date)
);

-- Down Migration

DROP TABLE IF EXISTS home_greetings;
