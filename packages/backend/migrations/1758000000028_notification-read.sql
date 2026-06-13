-- Migration 28 · Notification center read-state (Design spec D1)
-- ============================================================================
-- The mobile notification center lists a member's notifications with unread
-- badges and "mark all read". read_at is member-controlled display state —
-- it never affects scheduling/dispatch.
-- ============================================================================

-- Up Migration

ALTER TABLE notifications ADD COLUMN read_at TIMESTAMPTZ;
CREATE INDEX idx_notifications_user_recent ON notifications (user_id, scheduled_for DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_notifications_user_recent;
ALTER TABLE notifications DROP COLUMN IF EXISTS read_at;
