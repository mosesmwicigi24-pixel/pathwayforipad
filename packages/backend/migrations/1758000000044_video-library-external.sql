-- Migration 44 · Video Library: external videos + homepage welcome video
-- ============================================================================
-- Extends media_assets so the Video Library (Figma VideoLibrary) can manage both
-- hosted/transcoded assets (the existing Cloudinary/HLS pipeline) AND external,
-- best-effort-gated links (YouTube/Vimeo/direct/private). External links never
-- transcode: status = 'ready' on register.
--
-- NOTE on the existing `provider` column: migration 16 already added
-- media_assets.provider (VARCHAR(20) default 'cloudinary') to record the
-- *transcode pipeline* used ('cloudinary' | 'hls'). We do NOT touch it. The
-- YouTube/Vimeo/direct/private *origin* of an asset is a new, orthogonal column:
-- `video_source`.
-- ============================================================================

-- Up Migration

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS video_source      TEXT NOT NULL DEFAULT 'cloudinary'
    CHECK (video_source IN ('cloudinary', 'youtube', 'vimeo', 'direct', 'private')),
  ADD COLUMN IF NOT EXISTS external_url      TEXT,
  ADD COLUMN IF NOT EXISTS external_video_id TEXT,
  ADD COLUMN IF NOT EXISTS caption           TEXT,
  ADD COLUMN IF NOT EXISTS level_number      INT,
  ADD COLUMN IF NOT EXISTS is_homepage       BOOLEAN NOT NULL DEFAULT false;

-- Only ONE asset may be the homepage welcome video at a time (§ Figma: the single
-- mobile-app welcome video). Partial unique index enforces the single-row invariant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_homepage
  ON media_assets ((is_homepage)) WHERE is_homepage = true;

-- Down Migration

DROP INDEX IF EXISTS uq_media_assets_homepage;
ALTER TABLE media_assets
  DROP COLUMN IF EXISTS is_homepage,
  DROP COLUMN IF EXISTS level_number,
  DROP COLUMN IF EXISTS caption,
  DROP COLUMN IF EXISTS external_video_id,
  DROP COLUMN IF EXISTS external_url,
  DROP COLUMN IF EXISTS video_source;
