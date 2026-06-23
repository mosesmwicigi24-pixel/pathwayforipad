-- Event wall: attendee posts under a specific occurrence (image + caption), like
-- a chat/comment thread. Keyed by the materialized event_id (= occurrenceId).
-- Offline-safe (client-generated post_id + client_mutation_id idempotency).

-- Up Migration

CREATE TABLE event_posts (
  post_id            UUID PRIMARY KEY,                         -- client-generated
  event_id           VARCHAR(100) NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  author_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body               TEXT,                                     -- caption (optional when an image is posted)
  image_url          TEXT,                                     -- optional posted photo (Cloudinary)
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,           -- leader moderation
  hidden_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_posts_event ON event_posts (event_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS event_posts;
