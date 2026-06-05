-- Migration 03 · Enrollment, progress & the habit signal (spec §2.2, tables 5–7)
-- ============================================================================

-- Up Migration

CREATE TABLE enrollments (
  enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  current_level INT NOT NULL REFERENCES levels(level_number) DEFAULT 1,
  state         enrollment_state NOT NULL DEFAULT 'active',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (user_id)
);

CREATE TABLE module_progress (
  progress_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      UUID NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
  module_id          UUID NOT NULL REFERENCES modules(module_id),
  is_completed       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at       TIMESTAMPTZ,
  client_mutation_id UUID UNIQUE,                          -- idempotent offline completion
  row_version        INT NOT NULL DEFAULT 1,
  UNIQUE (enrollment_id, module_id)
);

-- The Hᵢ signal source: every lesson open / scripture read (append-only).
-- DEVIATION (flagged): the spec declares `event_id UUID PRIMARY KEY` and
-- `client_event_id UUID UNIQUE` on a table that is PARTITION BY RANGE (occurred_at).
-- PostgreSQL requires every unique/primary key on a partitioned table to include
-- all partition-key columns, so the keys are widened to include occurred_at. The
-- idempotency guarantee is preserved: (client_event_id, occurred_at) is still
-- unique, and offline replays carry the same occurred_at. See README.
CREATE TABLE interaction_events (
  event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind            VARCHAR(40) NOT NULL,                    -- 'lesson_open' | 'scripture_read' | 'video_75pct'
  module_id       UUID REFERENCES modules(module_id),
  occurred_at     TIMESTAMPTZ NOT NULL,                    -- client local event time (UTC stored)
  client_event_id UUID,                                    -- idempotency for offline replay
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, occurred_at),
  UNIQUE (client_event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Down Migration

DROP TABLE IF EXISTS interaction_events;
DROP TABLE IF EXISTS module_progress;
DROP TABLE IF EXISTS enrollments;
