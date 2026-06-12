-- Migration 25 · Member growth domains (Contract Matrix B6)
-- ============================================================================
-- Mobile "Growth" features: spiritual-gifts assessment (Likert, SERVER-scored
-- per §1.1 — the client never computes its own gift profile), private prayer
-- journal and saved verses (offline-synced, user-scoped; prayers are pastoral-
-- private and have NO leader/admin read path), and profile extensions
-- (gender / city / socials) for the new Profile tab.
-- ============================================================================

-- Up Migration

-- Profile extensions (mobile Profile tab + onboarding profile step).
ALTER TABLE users
  ADD COLUMN gender  VARCHAR(20) CHECK (gender IS NULL OR gender IN ('male','female','prefer_not_to_say')),
  ADD COLUMN city    VARCHAR(120),
  ADD COLUMN socials JSONB NOT NULL DEFAULT '{}'::jsonb;       -- {instagram, x, facebook, ...}

-- Spiritual-gifts question bank (Likert 1–5). Seeded; admin-editable later.
CREATE TABLE gift_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(20) NOT NULL UNIQUE,                     -- stable seed key, e.g. 'lead_1'
  gift_key    VARCHAR(40) NOT NULL,                            -- which gift this item measures
  prompt      TEXT NOT NULL,
  sort        INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Where-to-serve suggestions, matched to a member's top gifts.
CREATE TABLE serving_tracks (
  track_key   VARCHAR(40) PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  gift_keys   TEXT[] NOT NULL                                  -- gifts this track fits
);

-- One row per submitted assessment; the latest one is the member's profile.
CREATE TABLE gift_assessments (
  assessment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scores             JSONB NOT NULL,                           -- {gift_key: 0..100}
  top_gifts          TEXT[] NOT NULL,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_mutation_id UUID UNIQUE                               -- offline replay no-op (§3.6)
);
CREATE INDEX idx_gift_assessments_user ON gift_assessments (user_id, submitted_at DESC);

-- Private prayer journal (§5.4 pastoral privacy: user-scoped only; deletes are
-- HARD — a member removing a prayer removes it everywhere, tombstoned to sync).
CREATE TABLE prayer_entries (
  entry_id           UUID PRIMARY KEY,                         -- client-generated (offline-first)
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title              VARCHAR(200),
  body               TEXT NOT NULL,
  is_answered        BOOLEAN NOT NULL DEFAULT FALSE,
  answered_note      TEXT,
  answered_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),      -- LWW anchor for sync upserts
  client_mutation_id UUID
);
CREATE INDEX idx_prayer_entries_user ON prayer_entries (user_id, created_at DESC);

-- Saved verses ("Your verse library"), offline-synced; dedup per translation.
CREATE TABLE saved_verses (
  saved_verse_id     UUID PRIMARY KEY,                         -- client-generated (offline-first)
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reference          VARCHAR(80) NOT NULL,                     -- e.g. 'John 3:16'
  version            VARCHAR(12) NOT NULL DEFAULT 'KJV',
  verse_text         TEXT,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_mutation_id UUID,
  UNIQUE (user_id, reference, version)
);
CREATE INDEX idx_saved_verses_user ON saved_verses (user_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS saved_verses;
DROP TABLE IF EXISTS prayer_entries;
DROP TABLE IF EXISTS gift_assessments;
DROP TABLE IF EXISTS serving_tracks;
DROP TABLE IF EXISTS gift_questions;
ALTER TABLE users
  DROP COLUMN IF EXISTS socials,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS gender;
