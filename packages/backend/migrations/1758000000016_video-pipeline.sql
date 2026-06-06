-- Migration 16 · Video / adaptive streaming pipeline (Features v2 §V)
-- ============================================================================
-- Extends media_assets into a transcode-tracked asset, adds direct-to-storage
-- upload sessions (server never proxies bytes), cross-device resume positions
-- (offline-synced, LWW), and links modules to managed assets. 720p cap (§D.1).
-- ============================================================================

-- Up Migration

CREATE TYPE media_status AS ENUM ('uploading', 'transcoding', 'ready', 'failed');

ALTER TABLE media_assets
  ADD COLUMN status            media_status NOT NULL DEFAULT 'ready',
  ADD COLUMN source_object_key VARCHAR(512),
  ADD COLUMN hls_master_key    VARCHAR(512),
  ADD COLUMN ladder            JSONB,
  ADD COLUMN provider          VARCHAR(20) NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN content_hash      VARCHAR(64),
  ADD COLUMN created_by        UUID REFERENCES users(user_id),
  ADD COLUMN error_detail      TEXT;

-- Direct-to-storage upload sessions (§4.5: server signs, never proxies bytes).
CREATE TABLE video_uploads (
  upload_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id UUID NOT NULL REFERENCES media_assets(media_asset_id),
  created_by     UUID NOT NULL REFERENCES users(user_id),
  put_url_expiry TIMESTAMPTZ NOT NULL,
  byte_size_max  BIGINT NOT NULL,
  mime_allowed   VARCHAR(60) NOT NULL DEFAULT 'video/mp4',
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-device resume positions (offline-synced; LWW by updated_at — convenience
-- state, not "meaningful" §1.7 state, so last-writer-wins is acceptable here).
CREATE TABLE video_progress (
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  media_asset_id     UUID NOT NULL REFERENCES media_assets(media_asset_id) ON DELETE CASCADE,
  position_sec       INT  NOT NULL DEFAULT 0 CHECK (position_sec >= 0),
  completed_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
  client_mutation_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_asset_id)
);

-- Modules link to managed assets (video_url kept as legacy fallback, §D.6).
ALTER TABLE modules ADD COLUMN media_asset_id UUID REFERENCES media_assets(media_asset_id);

CREATE INDEX idx_video_progress_user_time ON video_progress (user_id, updated_at DESC);
CREATE INDEX idx_media_assets_pending ON media_assets (status) WHERE status <> 'ready';

-- Down Migration

DROP INDEX IF EXISTS idx_media_assets_pending;
DROP INDEX IF EXISTS idx_video_progress_user_time;
ALTER TABLE modules DROP COLUMN IF EXISTS media_asset_id;
DROP TABLE IF EXISTS video_progress;
DROP TABLE IF EXISTS video_uploads;
ALTER TABLE media_assets
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS source_object_key,
  DROP COLUMN IF EXISTS hls_master_key,
  DROP COLUMN IF EXISTS ladder,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS error_detail;
DROP TYPE IF EXISTS media_status;
