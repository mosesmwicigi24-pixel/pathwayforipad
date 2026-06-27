-- Event "Moments" — a curated gallery of community/event photos surfaced on the
-- mobile Events tab (the Figma "Moments" carousel). Pastoral team / leaders post a
-- moment (image + caption + optional tag) from the web portal; members view them.
-- Congregation-scoped (§5.4), soft-deletable, forward-only.

-- Up Migration

CREATE TABLE IF NOT EXISTS event_moments (
  moment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id  UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  image_url        TEXT NOT NULL,
  caption          TEXT,
  tag              TEXT,
  created_by       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- Feed read: newest non-deleted moments for a congregation.
CREATE INDEX IF NOT EXISTS event_moments_feed_idx
  ON event_moments (congregation_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Down Migration

DROP TABLE IF EXISTS event_moments;
