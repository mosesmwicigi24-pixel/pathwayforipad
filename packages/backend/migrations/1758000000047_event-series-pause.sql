-- Migration 47 · Event series pause / resume (Events page)
-- ============================================================================
-- The portal Events page can pause a recurring series so it stops projecting
-- (and materializing) future occurrences without deleting it. Resume restores
-- normal projection. A boolean flag on event_series; projectRange skips paused
-- series. Past/materialized occurrences are untouched — pause only affects the
-- forward-looking projection.
-- ============================================================================

-- Up Migration

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE event_series
  DROP COLUMN IF EXISTS is_paused;
