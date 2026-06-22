-- Migration 62 · Seed two reading plans with cover art + day segments
-- ============================================================================
-- "Now That You Are Saved" (5 days, foundations for new believers) and
-- "Dealing with Grief" (5 days, comfort). Each day has a Devotional, a Scripture
-- reading, and a Talk it Over — the YouVersion segment shape (migration 61).
-- Covers are self-hosted at /media (generated, navy/gold). Idempotent.
-- Also repoints the earlier "Anchored" plan to its self-hosted cover.
-- ============================================================================

-- Up Migration
UPDATE reading_plans
   SET image_url = 'https://pathway.nuruplace.org/media/plan-anchored.png'
 WHERE code = 'anchored-3';

-- ── Plan 1: Now That You Are Saved ─────────────────────────────────────────
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES (
  'now-saved',
  'Now That You Are Saved',
  'Your first five steps with Jesus',
  'You have begun the greatest journey of your life. Over five days, settle into the assurance of salvation, a new identity, prayer, the Word, and the family of God.',
  'Foundations', 5, 2,
  'https://pathway.nuruplace.org/media/plan-now-saved.png',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
SELECT p.plan_id, d.n, d.ref, d.title, d.body
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'John 3:1-16', 'Born Again',
   'Salvation is not turning over a new leaf — it is receiving a new life. Jesus told Nicodemus, "You must be born again." The moment you trusted Christ, the Spirit gave you new birth. Rest in this today: you are God''s child, and nothing can undo what He has done.'),
  (2, '2 Corinthians 5:17', 'A New Creation',
   'In Christ you are a new creation. Your past does not define you — your Father does. When old guilt whispers, answer with the truth: the old has gone, the new has come.'),
  (3, 'Matthew 6:5-13', 'Talking with God',
   'Prayer is not performance — it is a child talking with a Father who loves to listen. You don''t need fancy words. Bring Him your thanks, your needs, and your sorrows. He is near.'),
  (4, 'Psalm 119:97-105', 'Feeding on the Word',
   'A new life needs daily food. The Bible is how God speaks, guides, and grows you. Start small and steady — a few verses, a listening heart, one obedient step.'),
  (5, 'Acts 2:42-47', 'Better Together',
   'You were not saved to walk alone. From the very first days, believers shared life — teaching, prayer, meals, and care. Find your people. Join a cell. Grow in the family of God.')
) AS d(n, ref, title, body)
WHERE p.code = 'now-saved'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'now-saved'
JOIN LATERAL (VALUES
  (0, 'devotional', 'Devotional', NULL, d.content),
  (1, 'scripture',  'Today''s Reading', d.reference, '_' || d.reference || '_ — read it slowly and ask God to speak.'),
  (2, 'talk',       'Talk it Over', NULL, 'Tell someone walking this plan with you one thing God showed you today.')
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id);

-- ── Plan 2: Dealing with Grief ─────────────────────────────────────────────
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES (
  'dealing-with-grief',
  'Dealing with Grief',
  'Comfort for the brokenhearted',
  'Grief is love with nowhere to go. Over five days we bring our sorrow honestly to God, who is near to the brokenhearted and full of comfort and hope.',
  'Comfort', 5, 3,
  'https://pathway.nuruplace.org/media/plan-grief.png',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
SELECT p.plan_id, d.n, d.ref, d.title, d.body
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'Psalm 34:18', 'It''s Okay to Mourn',
   'Grief is not a lack of faith — it is love with nowhere to go. The Lord is close to the brokenhearted and saves those crushed in spirit. You don''t have to rush. He sits with you in the dark.'),
  (2, 'Psalm 13', 'Bring Your Lament',
   'Scripture gives us permission to be honest. "How long, O Lord?" is a prayer too. Pour out your questions and your tears; God can hold them all, and He will not turn away.'),
  (3, '2 Corinthians 1:3-5', 'The God of All Comfort',
   'Our Father is the God of all comfort, who comforts us in all our troubles. Often He comforts not by removing the pain but by drawing near within it — and later, through us, He comforts others.'),
  (4, 'John 11:25-26', 'Hope Beyond Goodbye',
   'Jesus said, "I am the resurrection and the life." For those in Christ, death is not the end of the story but a doorway. We grieve — but not as those without hope.'),
  (5, 'Lamentations 3:19-26', 'New Mercies',
   'Healing is not linear, and that is okay. Lamentations remembers the pain and still says: His mercies are new every morning. One morning at a time, His faithfulness will carry you.')
) AS d(n, ref, title, body)
WHERE p.code = 'dealing-with-grief'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'dealing-with-grief'
JOIN LATERAL (VALUES
  (0, 'devotional', 'Devotional', NULL, d.content),
  (1, 'scripture',  'Today''s Reading', d.reference, '_' || d.reference || '_ — read it slowly and let it comfort you.'),
  (2, 'talk',       'Talk it Over', NULL, 'Name one feeling you''re carrying today, and let someone pray with you.')
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id);

-- Down Migration
DELETE FROM reading_plans WHERE code IN ('now-saved', 'dealing-with-grief');
UPDATE reading_plans
   SET image_url = 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=1080&q=80'
 WHERE code = 'anchored-3';
