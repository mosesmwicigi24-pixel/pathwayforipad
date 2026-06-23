-- Prayer Wall (B6 extension). A PUBLIC, congregation-scoped space where members
-- post prayer requests others can pray under. Distinct from the private prayer
-- journal (prayer_entries, §5.4) — a member opts in by posting here (or sharing a
-- journal entry). Posts carry emoji reactions (the 🙏 "I'm praying" + others) and
-- comments. Author controls their post (mark answered, delete); leaders moderate.

-- Up Migration

CREATE TABLE prayer_wall_posts (
  post_id            UUID PRIMARY KEY,                         -- client-generated (offline-first)
  author_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  congregation_id    UUID REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  title              VARCHAR(200),
  body               TEXT NOT NULL,
  audio_url          TEXT,                                     -- optional voice note (self-hosted /media)
  is_answered        BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,           -- leader moderation
  hidden_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  source_entry_id    UUID,                                     -- set when shared from the private journal
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prayer_wall_posts_feed ON prayer_wall_posts (congregation_id, created_at DESC);

CREATE TABLE prayer_wall_reactions (
  post_id    UUID NOT NULL REFERENCES prayer_wall_posts(post_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  emoji      VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE prayer_wall_comments (
  comment_id         UUID PRIMARY KEY,
  post_id            UUID NOT NULL REFERENCES prayer_wall_posts(post_id) ON DELETE CASCADE,
  author_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  audio_url          TEXT,
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prayer_wall_comments_post ON prayer_wall_comments (post_id, created_at);

-- Down Migration

DROP TABLE IF EXISTS prayer_wall_comments;
DROP TABLE IF EXISTS prayer_wall_reactions;
DROP TABLE IF EXISTS prayer_wall_posts;
