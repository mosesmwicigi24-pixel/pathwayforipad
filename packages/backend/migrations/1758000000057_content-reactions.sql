-- Migration 57 · Content reactions (emoji + love counter) on media assets
-- ============================================================================
-- Members can react to content (starting with the homepage welcome video) with a
-- small set of emojis; ❤️ doubles as "Like". Polymorphic by (subject_type,
-- subject_id) so it can extend to other content later. One row per
-- (subject, user, emoji); toggling deletes/inserts.
-- ============================================================================

-- Up Migration
CREATE TABLE IF NOT EXISTS content_reactions (
  subject_type TEXT NOT NULL,
  subject_id   UUID NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  emoji        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_content_reactions_subject
  ON content_reactions (subject_type, subject_id);

-- Down Migration
DROP TABLE IF EXISTS content_reactions;
