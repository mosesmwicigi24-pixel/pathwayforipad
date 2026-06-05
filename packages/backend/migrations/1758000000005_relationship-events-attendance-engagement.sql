-- Migration 05 · Relationship tree, events, attendance & engagement (spec §2.2, tables 9–10)
-- ============================================================================

-- Up Migration

CREATE TABLE relationship_tree (
  tree_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  multiplier_id  UUID NOT NULL REFERENCES users(user_id),
  disciple_id    UUID NOT NULL UNIQUE REFERENCES users(user_id),
  established_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (multiplier_id <> disciple_id)
);

CREATE TABLE events (
  event_id        VARCHAR(100) PRIMARY KEY,                -- human/QR-friendly id
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  cell_group_id   UUID REFERENCES cell_groups(cell_group_id),
  title           VARCHAR(255) NOT NULL,
  occurs_at       TIMESTAMPTZ NOT NULL,
  qr_secret       VARCHAR(255) NOT NULL                    -- HMAC seed for scan tokens (§5)
);

CREATE TABLE attendance_logs (
  attendance_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_id       VARCHAR(100) NOT NULL REFERENCES events(event_id),
  client_scan_id UUID UNIQUE,                              -- idempotent offline scan
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

-- Engagement snapshot (the Eᵢ output table)
CREATE TABLE engagement_scores (
  user_id       UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  cell_group_id UUID REFERENCES cell_groups(cell_group_id),
  h_score       NUMERIC(4,3) NOT NULL,                     -- Hᵢ ∈ [0,1]
  c_score       NUMERIC(4,3) NOT NULL,                     -- Cᵢ ∈ [0,1]
  a_score       NUMERIC(4,3) NOT NULL,                     -- Aᵢ ∈ [0,1]
  e_score       NUMERIC(4,3) NOT NULL,                     -- Eᵢ composite
  band          engagement_band NOT NULL,
  window_end    DATE NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cohort table sorts on this; index makes "lowest score in my cells" instant.
CREATE INDEX idx_engagement_cell_score ON engagement_scores (cell_group_id, e_score);

-- Down Migration

DROP TABLE IF EXISTS engagement_scores;
DROP TABLE IF EXISTS attendance_logs;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS relationship_tree;
