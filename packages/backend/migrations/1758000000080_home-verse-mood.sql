-- The "Verse for today" becomes mood/season-aware: instead of one dated verse for
-- everyone, we pick from the mood-tagged daily_verses library (37 seasons × ~10
-- verses) to match where the member is right now (their prayers, reactions, reading).
-- We therefore cache the chosen verse's TEXT and the detected MOOD per member/day in
-- home_verses (previously only the personalized VERSE_POOL reference was cached, and
-- the client fetched its text from /scripture). Forward-only, additive columns.

-- Up Migration

ALTER TABLE home_verses ADD COLUMN IF NOT EXISTS verse_text TEXT;
ALTER TABLE home_verses ADD COLUMN IF NOT EXISTS mood VARCHAR(64);

-- Down Migration

ALTER TABLE home_verses DROP COLUMN IF EXISTS mood;
ALTER TABLE home_verses DROP COLUMN IF EXISTS verse_text;
