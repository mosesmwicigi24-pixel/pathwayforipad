-- Seed · "Rooted: 10 Days in the Psalms" — a curated 10-day reading plan with a
-- full per-day flow: Watch → Today's Reading → Devotional → Talk it Over (segment
-- order baked into `sort`). Idempotent on code / (plan, day) / per-day existence.
-- Video media is placeholder (stable sample + calm poster); replace with real
-- teaching videos via Content Studio.

INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES (
  'rooted-psalms-10',
  'Rooted: 10 Days in the Psalms',
  'Ten days to a deeper, steadier walk with God',
  'The Psalms teach us how to be honest with God — in joy, in fear, in repentance, and in praise. Over ten days we let these ancient prayers shape our own, growing roots that hold in every season.',
  'Foundations', 10, 0,
  'https://images.unsplash.com/photo-1508963493744-76fce69379c0?auto=format&fit=crop&w=1080&q=80',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
SELECT p.plan_id, v.n, v.ref, v.title, v.intro
FROM reading_plans p
CROSS JOIN (VALUES
  (1,  'Psalm 1',   'Two Roads',               'There are two ways to live — and only one leads to life that lasts.'),
  (2,  'Psalm 23',  'The Shepherd Who Leads',  'You are not walking alone; the Good Shepherd goes before you.'),
  (3,  'Psalm 27',  'One Thing',               'When one desire rules the heart, fear loses its grip.'),
  (4,  'Psalm 34',  'Taste and See',           'God is near to the broken — close enough to taste His goodness.'),
  (5,  'Psalm 51',  'A Clean Heart',           'Honest confession is the doorway to a renewed heart.'),
  (6,  'Psalm 63',  'Thirsty for God',         'The soul was made for God, and nothing else will satisfy it.'),
  (7,  'Psalm 91',  'Under His Wings',         'The safest place in the world is the shadow of the Almighty.'),
  (8,  'Psalm 103', 'Forget Not His Benefits', 'Remembering what God has done re-tunes the heart to praise.'),
  (9,  'Psalm 121', 'Lift Up Your Eyes',       'Help does not come from the hills, but from the One who made them.'),
  (10, 'Psalm 139', 'Fully Known, Fully Loved','You are completely known by God — and completely loved.')
) AS v(n, ref, title, intro)
WHERE p.code = 'rooted-psalms-10'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content, s.video_url, s.image_url
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'rooted-psalms-10'
JOIN (VALUES
  (1,  'Roots grow down before a tree grows up. Today, plant yourself by the stream — time in the Word, day and night — and let God grow what only He can.',
       'Which "road" is your daily routine actually shaping you toward? Name one small habit that would root you deeper this week.'),
  (2,  'A shepherd''s rod and staff are not for show — they guide and protect. Wherever today takes you, the Shepherd is leading, not watching from afar.',
       'Where do you need to trust the Shepherd to lead you right now?'),
  (3,  'David''s "one thing" was to dwell with God. A single, burning desire has a way of quieting a hundred smaller fears.',
       'If you could ask God for "one thing" this season, what would it be — and why?'),
  (4,  'God does not keep His distance from your pain. He leans in, close to the brokenhearted. Taste His goodness in the small mercies of today.',
       'Where have you "tasted" God''s goodness recently, even in something small?'),
  (5,  'Real change starts with honesty. David hid nothing — and found mercy. A clean heart is not earned; it is received.',
       'Is there something you need to bring honestly to God today? You don''t have to carry it alone.'),
  (6,  'Thirst is not weakness; it is design. The longing you feel is meant to drive you to the only Spring that satisfies.',
       'What have you been reaching for to satisfy a thirst only God can fill?'),
  (7,  'Refuge is a choice as much as a place. Those who "dwell" in the secret place find shelter when the storm comes.',
       'What would it look like to make God your refuge before the next hard day, not just during it?'),
  (8,  'Gratitude is memory turned to worship. Counting God''s benefits — forgiveness, healing, steadfast love — steadies a wandering heart.',
       'List three "benefits" God has shown you this month. Thank Him for one out loud.'),
  (9,  'When trouble looms, we scan the horizon for help. The psalmist looks higher — to the Maker of heaven and earth, who never sleeps.',
       'Where are you looking for help today? Lift your eyes — what changes when God is your keeper?'),
  (10, 'There is no corner of your life God has not searched and still loves. To be fully known and fully loved is the deepest security there is.',
       'How does it change today to know you are fully known — and fully loved — by God?')
) AS v(n, devo, prompt) ON v.n = d.day_number
JOIN LATERAL (VALUES
  (0, 'video',      'Watch',            NULL::text,
      'A short reflection to begin the day.',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
      'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&w=1080&q=80'),
  (1, 'scripture',  'Today''s Reading', d.reference,
      '_' || d.reference || '_ — read slowly, and ask the Lord to speak.', NULL, NULL),
  (2, 'devotional', 'Devotional',       NULL,
      v.devo, NULL, NULL),
  (3, 'talk',       'Talk it Over',     NULL,
      v.prompt, NULL, NULL)
) AS s(sort, kind, title, ref, content, video_url, image_url) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id
);
