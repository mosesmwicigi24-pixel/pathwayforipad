-- Migration 52 · Event/Announcement images + homepage-featured + announcement delete
-- ============================================================================
-- Admin portal: events and announcements gain Edit/Delete, an optional primary
-- image plus a small gallery (up to 5 extra → 6 total) shown as a carousel on
-- mobile, and a "Feature on homepage" toggle. Exactly ONE event and ONE
-- announcement may be featured at a time (partial unique index, mirroring the
-- featured-cell / welcome-video single-row invariant in migrations 44 & 46).
-- Announcements also get a soft-delete column (events already soft-delete via
-- deleted_at on event_series).
-- ============================================================================

-- Up Migration

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS primary_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_series_featured
  ON event_series ((is_featured)) WHERE is_featured = true;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS primary_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_featured
  ON announcements ((is_featured)) WHERE is_featured = true;

-- Down Migration

DROP INDEX IF EXISTS uq_announcements_featured;
ALTER TABLE announcements
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_featured,
  DROP COLUMN IF EXISTS gallery_image_urls,
  DROP COLUMN IF EXISTS primary_image_url;

DROP INDEX IF EXISTS uq_event_series_featured;
ALTER TABLE event_series
  DROP COLUMN IF EXISTS is_featured,
  DROP COLUMN IF EXISTS gallery_image_urls,
  DROP COLUMN IF EXISTS primary_image_url;
