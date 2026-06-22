-- Migration 61 · YouVersion-style plans: cover art + per-day SEGMENTS + per-segment progress
-- ============================================================================
-- A plan day now holds multiple ordered SEGMENTS (a devotional, several scripture
-- readings, a "Talk it Over") — each individually readable and checkable, exactly
-- like the YouVersion reader. Plans gain cover art + a tagline. Per-segment
-- completion rolls up to per-day completion (reading_plan_progress.completed_days).
-- A small starter plan is seeded so the experience is populated out of the box.
-- ============================================================================

-- Up Migration
ALTER TABLE reading_plans ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE reading_plans ADD COLUMN IF NOT EXISTS subtitle  TEXT;

CREATE TABLE IF NOT EXISTS reading_plan_day_segments (
  segment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id UUID NOT NULL REFERENCES reading_plan_days(plan_day_id) ON DELETE CASCADE,
  sort        INT  NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'reading'
              CHECK (kind IN ('devotional', 'scripture', 'video', 'talk', 'reading')),
  title       VARCHAR(200) NOT NULL,
  reference   VARCHAR(160),
  content     TEXT,
  video_url   TEXT,
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpds_day ON reading_plan_day_segments (plan_day_id, sort);

CREATE TABLE IF NOT EXISTS reading_plan_segment_progress (
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  segment_id   UUID NOT NULL REFERENCES reading_plan_day_segments(segment_id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, segment_id)
);

-- ── Seed a creative starter plan (idempotent) ──────────────────────────────
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES (
  'anchored-3',
  'Anchored: Peace in the Storm',
  'A 3-day walk into unshakable hope',
  'When life is difficult, God draws near. Over three days we anchor our hearts in His presence, His promises, and His peace.',
  'Foundations', 3, 1,
  'https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=1080&q=80',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
SELECT p.plan_id, d.n, d.ref, d.title, d.intro
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'Psalm 46', 'When Life Is Difficult', 'God is our refuge and strength, an ever-present help in trouble.'),
  (2, 'Isaiah 43:1-3', 'He Is With You', 'When you pass through the waters, I will be with you.'),
  (3, 'Hebrews 6:13-20', 'Anchored in Hope', 'We have this hope as an anchor for the soul, firm and secure.')
) AS d(n, ref, title, intro)
WHERE p.code = 'anchored-3'
ON CONFLICT (plan_id, day_number) DO NOTHING;

-- Segments per day: a Devotional, the Scripture reading, and a Talk it Over.
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'anchored-3'
JOIN LATERAL (VALUES
  (0, 'devotional', 'Devotional', NULL,
      'He was arrested for preaching the gospel, yet refused to give up telling people the good news about Jesus. When life is difficult, the difference is not the absence of the storm — it is the presence of God in it.'),
  (1, 'scripture', 'Today''s Reading', d.reference, '_' || d.reference || '_ — read slowly, and ask the Lord to speak.'),
  (2, 'talk', 'Talk it Over', NULL,
      'Where do you most need God''s peace today? Share one honest sentence with someone walking this plan with you.')
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id
);

-- Down Migration
DROP TABLE IF EXISTS reading_plan_segment_progress;
DROP TABLE IF EXISTS reading_plan_day_segments;
ALTER TABLE reading_plans DROP COLUMN IF EXISTS subtitle;
ALTER TABLE reading_plans DROP COLUMN IF EXISTS image_url;
DELETE FROM reading_plans WHERE code = 'anchored-3';
