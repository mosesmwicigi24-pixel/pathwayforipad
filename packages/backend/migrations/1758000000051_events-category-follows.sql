-- Migration 51 · Events tab: series category + series follows (mobile "Events" make).
-- ============================================================================
-- The redesigned Events tab needs two things the schema didn't carry:
--   • a short category on a series (Worship / Cell / Leaders / Youth, …) that
--     drives the filter chips and the colored badge on each event card; and
--   • a per-member "follow" on a series, backing the "Series you follow" list
--     (follow/unfollow + a per-series unread/"new" indicator via last_seen_at).
-- Both are additive, forward-only.
-- ============================================================================

-- Up Migration

ALTER TABLE event_series ADD COLUMN category VARCHAR(24);

CREATE TABLE event_series_follows (
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  series_id    UUID NOT NULL REFERENCES event_series(series_id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ,                       -- when the member last opened the series (for "N new")
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX idx_event_series_follows_user ON event_series_follows (user_id);

-- Down Migration

DROP TABLE IF EXISTS event_series_follows;
ALTER TABLE event_series DROP COLUMN category;
