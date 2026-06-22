-- Migration 59 · Cover image for cells ("This week at Nuru" homepage card)
-- ============================================================================
-- A cell can carry a cover image, shown on the mobile homepage featured-cell card
-- (and the admin cell editor). Image bytes are uploaded via the existing signed
-- Cloudinary flow; we store the delivered URL.
-- ============================================================================

-- Up Migration
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Down Migration
ALTER TABLE cell_groups DROP COLUMN IF EXISTS image_url;
