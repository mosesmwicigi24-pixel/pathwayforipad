-- Migration 21 · Attendance + events ops (Design Contract Matrix B2)
-- ============================================================================
-- Web portal Events/Attendance screens: per-series toggles (RSVP / QR /
-- reminders / check-in window) copied onto materialized occurrences, manual
-- check-in with reason (leader-recorded, audited), and walk-in/first-time
-- guests (non-members, so a separate table rather than a nullable user_id).
-- ============================================================================

-- Up Migration

ALTER TABLE event_series
  ADD COLUMN rsvp_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN qr_enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN reminders_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN checkin_opens_min_before INT;                 -- null = anytime

ALTER TABLE events
  ADD COLUMN rsvp_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN qr_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN allow_manual_checkin  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN checkin_opens_at      TIMESTAMPTZ;            -- null = anytime

ALTER TABLE attendance_logs
  ADD COLUMN method      VARCHAR(10) NOT NULL DEFAULT 'qr',  -- 'qr' | 'manual'
  ADD COLUMN recorded_by UUID REFERENCES users(user_id),     -- the leader, for manual
  ADD COLUMN note        TEXT;                               -- manual check-in reason

CREATE TABLE event_guests (
  guest_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    VARCHAR(100) NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  guest_name  VARCHAR(255) NOT NULL,
  phone       VARCHAR(32),
  first_time  BOOLEAN NOT NULL DEFAULT TRUE,
  recorded_by UUID NOT NULL REFERENCES users(user_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_guests_event ON event_guests (event_id);

-- Down Migration

DROP INDEX IF EXISTS idx_event_guests_event;
DROP TABLE IF EXISTS event_guests;
ALTER TABLE attendance_logs
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS recorded_by,
  DROP COLUMN IF EXISTS method;
ALTER TABLE events
  DROP COLUMN IF EXISTS checkin_opens_at,
  DROP COLUMN IF EXISTS allow_manual_checkin,
  DROP COLUMN IF EXISTS qr_enabled,
  DROP COLUMN IF EXISTS rsvp_enabled;
ALTER TABLE event_series
  DROP COLUMN IF EXISTS checkin_opens_min_before,
  DROP COLUMN IF EXISTS reminders_enabled,
  DROP COLUMN IF EXISTS qr_enabled,
  DROP COLUMN IF EXISTS rsvp_enabled;
