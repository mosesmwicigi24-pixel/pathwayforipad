-- Reactions on the shared "Verse for today". The daily-verse plan shows the SAME
-- verse to everyone on a given day, so reactions are community-wide counters per
-- emoji. The PRIMARY KEY (user_id, day_date) enforces exactly ONE reaction per
-- member per day — switching emoji UPDATES the row, so the count moves from the old
-- emoji to the new one (no double-counting).

-- Up Migration

CREATE TABLE verse_reactions (
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_date   DATE NOT NULL,
  emoji      VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_date)
);
CREATE INDEX verse_reactions_day_idx ON verse_reactions (day_date);

-- Down Migration

DROP TABLE IF EXISTS verse_reactions;
