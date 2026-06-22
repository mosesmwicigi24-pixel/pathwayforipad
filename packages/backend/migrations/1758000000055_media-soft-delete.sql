-- Migration 55 · Soft-delete for media assets + cleanup of dead placeholders
-- ============================================================================
-- Deleted videos must vanish from the library AND the processing queue. We add a
-- nullable deleted_at; archive sets it (instead of the old status='failed' hack),
-- and listAssets filters deleted_at IS NULL. We also retroactively soft-delete:
--   (a) rows previously "archived" (error_detail='archived'), and
--   (b) stale 'pending' upload placeholders from the old Cloudinary flow that
--       never completed (cloudinary_id='pending', still uploading/transcoding) —
-- so they stop polluting the queue.
-- ============================================================================

-- Up Migration
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- (a) previously archived assets → soft-deleted
UPDATE media_assets
   SET deleted_at = now()
 WHERE deleted_at IS NULL AND error_detail = 'archived';

-- (b) dead upload placeholders that never produced a real video
UPDATE media_assets
   SET deleted_at = now()
 WHERE deleted_at IS NULL
   AND cloudinary_id = 'pending'
   AND status IN ('uploading', 'transcoding')
   AND created_at < now() - interval '1 hour';

CREATE INDEX IF NOT EXISTS idx_media_assets_not_deleted
  ON media_assets (created_at DESC) WHERE deleted_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_media_assets_not_deleted;
ALTER TABLE media_assets DROP COLUMN IF EXISTS deleted_at;
