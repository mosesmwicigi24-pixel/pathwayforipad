-- Migration 48 · Event series draft/active status (Events page "Save as draft")
-- ============================================================================
-- The portal Create-event modal offers "Save as draft" vs "Create event". A
-- draft series is recorded but kept out of member-facing projection and is not
-- materialized (no occurrences / reminders) until it is published. Leaders and
-- Admins still see their own drafts on the calendar. Existing rows are 'active'.
-- ============================================================================

-- Up Migration

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active'));

-- Down Migration

ALTER TABLE event_series
  DROP COLUMN IF EXISTS status;
