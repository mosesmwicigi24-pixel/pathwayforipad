-- Migration 63 · Add a "Watch" video segment to each plan day
-- ============================================================================
-- Every day of the seeded plans gets an inline video as its first segment
-- (YouVersion-style — a short clip atop the day). Uses a self-hosted sample clip
-- at /media; replace per day with real teaching videos via Content Studio.
-- Existing segments shift down by one so the video leads. Idempotent.
-- ============================================================================

-- Up Migration
UPDATE reading_plan_day_segments s SET sort = s.sort + 1
  FROM reading_plan_days d JOIN reading_plans p ON p.plan_id = d.plan_id
 WHERE s.plan_day_id = d.plan_id
   AND p.code IN ('now-saved', 'dealing-with-grief', 'anchored-3')
   AND NOT EXISTS (SELECT 1 FROM reading_plan_day_segments v WHERE v.plan_day_id = s.plan_day_id AND v.kind = 'video');

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, content, video_url)
SELECT d.plan_day_id, 0, 'video', 'Watch',
       'A short clip to set today''s reading (sample — replace with your teaching video in Content Studio).',
       'https://pathway.nuruplace.org/media/sample-teaching.mp4'
  FROM reading_plan_days d JOIN reading_plans p ON p.plan_id = d.plan_id
 WHERE p.code IN ('now-saved', 'dealing-with-grief', 'anchored-3')
   AND NOT EXISTS (SELECT 1 FROM reading_plan_day_segments v WHERE v.plan_day_id = d.plan_day_id AND v.kind = 'video');

-- Down Migration
DELETE FROM reading_plan_day_segments s
 USING reading_plan_days d, reading_plans p
 WHERE s.plan_day_id = d.plan_id AND d.plan_id = p.plan_id
   AND p.code IN ('now-saved', 'dealing-with-grief', 'anchored-3') AND s.kind = 'video';
UPDATE reading_plan_day_segments s SET sort = GREATEST(s.sort - 1, 0)
  FROM reading_plan_days d JOIN reading_plans p ON p.plan_id = d.plan_id
 WHERE s.plan_day_id = d.plan_id AND p.code IN ('now-saved', 'dealing-with-grief', 'anchored-3');
