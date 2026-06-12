-- Migration 24 · Announcements (Contract Matrix B5)
-- ============================================================================
-- Portal "Announcements": compose → pick channels (push / email / sms /
-- whatsapp / banner) → pick audience (all / cells / level) → send now or
-- schedule. Push/email ride the existing notifications infra (quiet hours +
-- daily caps, §1.5); SMS/WhatsApp go through an abstracted MessageProvider
-- (faked in tests, §X); 'banner' is in-app and fetched by members online.
-- Per-recipient-per-channel deliveries power delivered/open stats.
-- ============================================================================

-- Up Migration

CREATE TABLE announcements (
  announcement_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(200) NOT NULL,
  body             TEXT NOT NULL,                            -- Markdown (rich-text UI, MD storage)
  channels         TEXT[] NOT NULL CHECK (channels <> '{}' AND channels <@ ARRAY['push','email','sms','whatsapp','banner']),
  audience_kind    VARCHAR(10) NOT NULL CHECK (audience_kind IN ('all','cells','level')),
  audience_cells   UUID[],                                   -- when audience_kind='cells'
  audience_level   INT REFERENCES levels(level_number),      -- when audience_kind='level'
  status           VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sent','cancelled')),
  scheduled_at     TIMESTAMPTZ,                              -- required when status='scheduled'
  sent_at          TIMESTAMPTZ,
  banner_expires_at TIMESTAMPTZ,                             -- banner channel stops showing after this
  created_by       UUID NOT NULL REFERENCES users(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audience_shape CHECK (
    (audience_kind = 'all'   AND audience_cells IS NULL AND audience_level IS NULL) OR
    (audience_kind = 'cells' AND audience_cells IS NOT NULL AND array_length(audience_cells, 1) >= 1 AND audience_level IS NULL) OR
    (audience_kind = 'level' AND audience_level IS NOT NULL AND audience_cells IS NULL)
  )
);

CREATE INDEX idx_announcements_due ON announcements (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_announcements_recent ON announcements (created_at DESC);

CREATE TABLE announcement_deliveries (
  delivery_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel         VARCHAR(10) NOT NULL CHECK (channel IN ('push','email','sms','whatsapp','banner')),
  status          VARCHAR(12) NOT NULL CHECK (status IN ('scheduled','suppressed','delivered','failed')),
  notification_id UUID REFERENCES notifications(notification_id),  -- push/email path
  provider_ref    VARCHAR(120),                                    -- sms/whatsapp provider message id
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  UNIQUE (announcement_id, user_id, channel)                       -- idempotent fan-out
);

CREATE INDEX idx_ann_deliveries_user ON announcement_deliveries (user_id, channel);
CREATE INDEX idx_ann_deliveries_ann ON announcement_deliveries (announcement_id);

-- Down Migration

DROP TABLE IF EXISTS announcement_deliveries;
DROP TABLE IF EXISTS announcements;
