-- Memory verses gain an optional release/scheduled date (Content Studio make
-- shows a date alongside the week number). Nullable — the library still paces by
-- week_number; the date is just an authoring convenience.

-- Up Migration

ALTER TABLE memory_verses ADD COLUMN IF NOT EXISTS release_date DATE;

-- Down Migration

ALTER TABLE memory_verses DROP COLUMN IF EXISTS release_date;
