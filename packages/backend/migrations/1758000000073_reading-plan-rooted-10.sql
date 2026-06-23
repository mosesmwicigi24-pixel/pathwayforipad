-- Canonical reading-plan segment order across ALL existing plans:
-- Watch → Today's Reading → Devotional → Talk it Over. The screens render strictly
-- by `sort`, so this fixes the order for plans seeded before this change. (The new
-- curated 10-day plan ships in seeds/07_reading-plan-rooted.sql with the order
-- already baked in.)

-- Up Migration

UPDATE reading_plan_day_segments SET sort = CASE kind
  WHEN 'video' THEN 0
  WHEN 'scripture' THEN 1
  WHEN 'reading' THEN 1
  WHEN 'devotional' THEN 2
  WHEN 'talk' THEN 3
  ELSE sort
END;

-- Down Migration
-- (No-op: a sort re-ordering is not meaningfully reversible.)
SELECT 1;
