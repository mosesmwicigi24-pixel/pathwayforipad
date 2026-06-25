-- Per-day tailored "Verse for today" per member. The server chooses a vetted
-- Scripture *reference* from a curated, theme-tagged pool based on the member's
-- real growth signals (the discipline they're leaning into / need encouragement
-- in), caches it here so it's stable through the day, and reads recent rows to
-- avoid repeating a verse the member just saw. Scripture text itself is fetched
-- by the client from /scripture — we only persist the chosen reference + why.
-- Server-authoritative (§1.1); mirrors home_greetings.

-- Up Migration

CREATE TABLE home_verses (
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_date   DATE NOT NULL,
  reference  TEXT NOT NULL,
  theme      TEXT NOT NULL,
  reason     TEXT NOT NULL,
  version    TEXT NOT NULL DEFAULT 'WEB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_date)
);

-- Recent-history lookup (avoid repeating a member's recent verses).
CREATE INDEX home_verses_user_recent_idx ON home_verses (user_id, day_date DESC);

-- Down Migration

DROP TABLE IF EXISTS home_verses;
