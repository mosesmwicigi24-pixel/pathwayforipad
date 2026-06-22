-- Migration 60 · Saved devotional reflections (one per member per devotional)
-- ============================================================================
-- The devotional reader's reflection prompt now persists the member's response
-- (previously local-only). Saving also marks the "Reflection" rhythm done for the
-- day (via interaction_events, kind='reflection').
-- ============================================================================

-- Up Migration
CREATE TABLE IF NOT EXISTS devotional_reflections (
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  devotional_id UUID NOT NULL REFERENCES devotionals(devotional_id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, devotional_id)
);

-- Down Migration
DROP TABLE IF EXISTS devotional_reflections;
