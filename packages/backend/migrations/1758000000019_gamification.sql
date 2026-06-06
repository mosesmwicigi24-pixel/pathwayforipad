-- Migration 19 · Gamification: faithfulness, not competition (Features v2 §G)
-- ============================================================================
-- Celebrates milestones; never ranks members' spirituality. Awards derive ONLY
-- from already-verified server signals; clients can never originate an award.
-- An append-only provenance ledger with a dedupe key prevents double awards.
-- ============================================================================

-- Up Migration

CREATE TYPE badge_category AS ENUM ('journey', 'consistency', 'community', 'service');

CREATE TABLE badges (
  badge_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(60) UNIQUE NOT NULL,
  name        VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  icon_key    VARCHAR(255),
  category    badge_category NOT NULL,
  criteria    JSONB NOT NULL,                     -- registered rule descriptor (no arbitrary exprs)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_badges (
  user_badge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  badge_id      UUID NOT NULL REFERENCES badges(badge_id),
  awarded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        JSONB NOT NULL,                   -- {event, ref ids} — provenance
  revoked_at    TIMESTAMPTZ,
  UNIQUE (user_id, badge_id)
);

CREATE TABLE user_streaks (
  user_id             UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_streak_days INT NOT NULL DEFAULT 0,
  longest_streak_days INT NOT NULL DEFAULT 0,
  last_active_date    DATE,                        -- in the MEMBER's timezone, not UTC
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gamification_events (
  gevent_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind        VARCHAR(40) NOT NULL,
  ref         JSONB NOT NULL,
  dedupe_key  VARCHAR(120) UNIQUE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gevents_user ON gamification_events (user_id, occurred_at DESC);
CREATE INDEX idx_user_badges_user ON user_badges (user_id) WHERE revoked_at IS NULL;
-- Starter badge catalog is loaded as reference data via seeds/04_badges.sql.

-- Down Migration

DROP INDEX IF EXISTS idx_user_badges_user;
DROP INDEX IF EXISTS idx_gevents_user;
DROP TABLE IF EXISTS gamification_events;
DROP TABLE IF EXISTS user_streaks;
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS badges;
DROP TYPE IF EXISTS badge_category;
