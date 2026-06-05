-- Migration 07 · Certificates, notifications, media, devices/sync, audit & outbox (spec §2.2)
-- ============================================================================

-- Up Migration

CREATE TABLE certificates (
  certificate_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(user_id),
  level_number      INT REFERENCES levels(level_number),  -- null = full-program
  verification_code VARCHAR(24) UNIQUE NOT NULL,           -- printed on the PDF
  pdf_object_key    VARCHAR(512) NOT NULL,                 -- object storage path
  content_hash      VARCHAR(64) NOT NULL,                  -- tamper-evidence
  signature         TEXT NOT NULL,                         -- detached sig (KMS key)
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  token_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform   VARCHAR(12) NOT NULL,                         -- 'ios' | 'android'
  token      VARCHAR(512) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE TABLE notification_preferences (
  user_id       UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  push_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_from    TIME NOT NULL DEFAULT '21:00',             -- local time, no nudges after
  quiet_to      TIME NOT NULL DEFAULT '07:00',
  max_daily     INT NOT NULL DEFAULT 3                     -- caps the 12-nudge cadence
);

CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel         notif_channel NOT NULL,
  template        VARCHAR(80) NOT NULL,
  payload         JSONB NOT NULL,
  status          notif_status NOT NULL DEFAULT 'scheduled',
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ
);

CREATE TABLE media_assets (
  media_asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cloudinary_id  VARCHAR(255) NOT NULL,
  kind           VARCHAR(40) NOT NULL,                     -- 'lesson_video' | 'vod' | 'product'
  duration_sec   INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ADD CONSTRAINT fk_product_media
  FOREIGN KEY (media_asset_id) REFERENCES media_assets(media_asset_id);

-- Registered client devices + per-device sync cursors
CREATE TABLE client_devices (
  device_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform     VARCHAR(12) NOT NULL,
  app_version  VARCHAR(20),
  last_seen_at TIMESTAMPTZ,
  sync_cursors JSONB NOT NULL DEFAULT '{}'                 -- { domain: last_seen_change_id }
);

-- Change log feeding delta-pull (one row per server-side mutation)
CREATE TABLE change_log (
  change_id  BIGSERIAL PRIMARY KEY,
  domain     VARCHAR(40) NOT NULL,
  row_id     UUID,
  user_id    UUID,                                         -- scope: whose deltas this belongs to
  op         VARCHAR(10) NOT NULL,                         -- 'upsert' | 'delete'
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  audit_id    BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  action      VARCHAR(80) NOT NULL,
  entity      VARCHAR(60) NOT NULL,
  entity_id   VARCHAR(64),
  metadata    JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox: business write + this row commit together
CREATE TABLE outbox (
  outbox_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        VARCHAR(80) NOT NULL,                       -- 'certificate.issue' | 'engagement.recompute' ...
  payload      JSONB NOT NULL,
  status       outbox_status NOT NULL DEFAULT 'pending',
  attempts     INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS change_log;
DROP TABLE IF EXISTS client_devices;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_product_media;
DROP TABLE IF EXISTS media_assets;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS push_tokens;
DROP TABLE IF EXISTS certificates;
