-- Migration 17 · Calendar: recurrence, projection, RSVP (Features v2 §C)
-- ============================================================================
-- Master/exception RRULE model (no instance bloat). Recurring series project
-- into materialized occurrence rows in the existing `events` table within a
-- rolling horizon, so QR attendance keeps its stable event_id idempotency.
-- Series store an IANA timezone + local wall-clock anchor and expand in that zone
-- (§D.2 — UTC-only RRULEs drift across DST).
-- ============================================================================

-- Up Migration

CREATE TYPE event_visibility AS ENUM ('congregation', 'cell', 'leaders');
CREATE TYPE rsvp_status      AS ENUM ('going', 'maybe', 'declined');

CREATE TABLE event_series (
  series_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  cell_group_id   UUID REFERENCES cell_groups(cell_group_id),   -- null = congregation-wide
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  location        VARCHAR(255),
  timezone        VARCHAR(64) NOT NULL,            -- IANA; expansion happens in this zone
  dtstart_local   TIMESTAMP NOT NULL,              -- wall-clock anchor in `timezone`
  duration_min    INT NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  rrule           TEXT,                            -- RFC 5545; NULL = one-off
  visibility      event_visibility NOT NULL DEFAULT 'cell',
  created_by      UUID NOT NULL REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE event_exceptions (
  exception_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id         UUID NOT NULL REFERENCES event_series(series_id) ON DELETE CASCADE,
  original_start_at TIMESTAMPTZ NOT NULL,          -- identifies the instance (UTC)
  is_cancelled      BOOLEAN NOT NULL DEFAULT FALSE,
  new_start_at      TIMESTAMPTZ,
  new_end_at        TIMESTAMPTZ,
  note              VARCHAR(255),
  UNIQUE (series_id, original_start_at)
);

-- Existing `events` rows become materialized occurrences.
ALTER TABLE events
  ADD COLUMN series_id        UUID REFERENCES event_series(series_id) ON DELETE CASCADE,
  ADD COLUMN occurrence_start TIMESTAMPTZ,
  ADD CONSTRAINT uq_series_occurrence UNIQUE (series_id, occurrence_start);

CREATE TABLE event_rsvps (
  rsvp_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           VARCHAR(100) NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status             rsvp_status NOT NULL,
  client_mutation_id UUID UNIQUE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_event_series_cong ON event_series (congregation_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_event_series_cell ON event_series (cell_group_id);
CREATE INDEX idx_events_series_occ ON events (series_id, occurrence_start);
CREATE INDEX idx_event_rsvps_user_time ON event_rsvps (user_id, updated_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_event_rsvps_user_time;
DROP INDEX IF EXISTS idx_events_series_occ;
DROP INDEX IF EXISTS idx_event_series_cell;
DROP INDEX IF EXISTS idx_event_series_cong;
DROP TABLE IF EXISTS event_rsvps;
ALTER TABLE events DROP CONSTRAINT IF EXISTS uq_series_occurrence;
ALTER TABLE events DROP COLUMN IF EXISTS occurrence_start;
ALTER TABLE events DROP COLUMN IF EXISTS series_id;
DROP TABLE IF EXISTS event_exceptions;
DROP TABLE IF EXISTS event_series;
DROP TYPE IF EXISTS rsvp_status;
DROP TYPE IF EXISTS event_visibility;
