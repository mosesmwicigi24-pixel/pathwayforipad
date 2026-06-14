-- Migration 36 · Per-admin notification read/dismiss state (Final Pathway make).
-- ============================================================================
-- The notifications feed (GET /admin/notifications) is synthesized from real
-- events with STABLE string ids (e.g. 'mbr-<uuid>', 'cert-<uuid>', 'aud-<id>').
-- This table records, per portal user, which feed items they've read or
-- dismissed — so read-state follows them across devices instead of living in
-- one browser's localStorage. notification_id is an opaque feed id (no FK, since
-- the feed has no backing rows of its own).
-- ============================================================================

-- Up Migration

CREATE TABLE notification_states (
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notification_id VARCHAR(80) NOT NULL,
  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- Down Migration

DROP TABLE IF EXISTS notification_states;
