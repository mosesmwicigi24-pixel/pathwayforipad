-- Reactions on event-wall posts (the "buzz" feed). Each member may hold exactly
-- ONE reaction per post — the PRIMARY KEY (post_id, user_id) enforces it. Tapping
-- a different emoji UPDATES the row (the count moves from the old emoji to the new
-- one — "keep the latter", no double-counting); tapping the held emoji again
-- removes the row (toggle off). Counts are derived by aggregating this table.

-- Up Migration

CREATE TABLE event_post_reactions (
  post_id    UUID NOT NULL REFERENCES event_posts(post_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind       VARCHAR(16) NOT NULL CHECK (kind IN ('cheer', 'love')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_event_post_reactions_post ON event_post_reactions (post_id);

-- Down Migration

DROP TABLE IF EXISTS event_post_reactions;
