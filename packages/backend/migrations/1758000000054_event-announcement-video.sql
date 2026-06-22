-- Migration 54 · Attachable video on events + announcements
-- ============================================================================
-- The Video Library can now attach a (Cloudinary) video to an event series or an
-- announcement, alongside the existing module + homepage targets. A nullable
-- video_url holds the chosen delivery URL; set/cleared via dedicated admin routes.
-- ============================================================================

-- Up Migration
ALTER TABLE event_series  ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Down Migration
ALTER TABLE event_series  DROP COLUMN IF EXISTS video_url;
ALTER TABLE announcements DROP COLUMN IF EXISTS video_url;
