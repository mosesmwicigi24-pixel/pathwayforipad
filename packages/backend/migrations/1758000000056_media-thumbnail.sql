-- Migration 56 · Per-video thumbnail (poster) image
-- ============================================================================
-- Each media asset can carry a thumbnail image shown in the Video Library and
-- anywhere the video is referenced. The image is either uploaded by the admin or
-- captured from a frame of the video (client-side) and stored on our own disk
-- (served via /media), so thumbnail_url is a public URL we host.
-- ============================================================================

-- Up Migration
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Down Migration
ALTER TABLE media_assets DROP COLUMN IF EXISTS thumbnail_url;
