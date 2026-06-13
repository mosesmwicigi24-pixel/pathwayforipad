-- Seed · Growth content (Contract Matrix D5). Church-curated devotionals,
-- memory verses, reading plans + days, and resources. Idempotent on stable keys.

-- ── Devotionals ──
INSERT INTO devotionals (day_number, series, title, scripture_ref, scripture_text, body, reflection_prompt) VALUES
  (1, 'Inner Transformation', 'The renewed mind',
   'Romans 12:2', 'Do not be conformed to this age, but be transformed by the renewing of your mind.',
   E'Transformation begins not with behaviour but with the mind. Paul does not say *try harder* — he says *be renewed*. The Spirit re-patterns how we think, and changed thinking reshapes a changed life.\n\nToday, notice one thought you hold by habit. Hold it next to Scripture. Let God renew it.',
   'What thought from this week needs to be held next to Scripture?'),
  (2, 'Inner Transformation', 'Hidden with Christ',
   'Colossians 3:3', 'For you have died, and your life is hidden with Christ in God.',
   E'Your truest identity is not on display — it is hidden, safe, in Christ. That hiddenness is not absence; it is security. Nothing can reach what God is keeping.',
   'Where are you seeking visibility when God is offering you security?')
ON CONFLICT (day_number) DO NOTHING;

-- ── Memory verses ──
INSERT INTO memory_verses (reference, verse_text, version, week_number, sort) VALUES
  ('Romans 12:2', 'Do not be conformed to this age, but be transformed by the renewing of your mind.', 'WEB', 4, 1),
  ('Philippians 4:13', 'I can do all things through Christ who strengthens me.', 'WEB', NULL, 2),
  ('Psalm 23:1', 'The Lord is my shepherd; I shall lack nothing.', 'WEB', NULL, 3),
  ('Isaiah 40:31', 'But those who wait for the Lord will renew their strength.', 'WEB', NULL, 4)
ON CONFLICT DO NOTHING;

-- ── Reading plans + days ──
INSERT INTO reading_plans (code, title, description, category, day_count, sort) VALUES
  ('gospel-of-john', 'Gospel of John', 'Walk through the life of Jesus with the beloved disciple.', 'Foundations', 21, 1),
  ('psalms-of-comfort', 'Psalms of Comfort', 'Thirty days in the Psalms for the weary heart.', 'Devotional', 30, 2),
  ('sermon-on-the-mount', 'Sermon on the Mount', 'Ten days in the heart of Jesus'' teaching.', 'Discipleship', 10, 3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
SELECT p.plan_id, d.day_number, d.reference, d.title, d.content
FROM reading_plans p
JOIN (VALUES
  ('gospel-of-john', 1, 'John 1:1–18', 'The Word became flesh', 'In the beginning was the Word…'),
  ('gospel-of-john', 2, 'John 1:19–51', 'The first disciples', 'Come and see.'),
  ('gospel-of-john', 3, 'John 2:1–25', 'Water into wine', 'The first sign at Cana.'),
  ('gospel-of-john', 4, 'John 4:1–26', 'Living water', 'Jesus and the Samaritan woman.')
) AS d(code, day_number, reference, title, content) ON d.code = p.code
ON CONFLICT (plan_id, day_number) DO NOTHING;

-- ── Resources ──
INSERT INTO resources (title, author, kind, duration_label, sort) VALUES
  ('The Pursuit of God', 'A.W. Tozer', 'book', '184 pages', 1),
  ('Renewing the mind · Sermon', 'Pastor Chris', 'audio', '42 min', 2),
  ('What it means to be the Church', 'Tim Keller', 'video', '28 min', 3),
  ('Foundations of prayer', 'Nuru Pathway', 'article', '8 min read', 4),
  ('Mere Christianity', 'C.S. Lewis', 'book', '228 pages', 5)
ON CONFLICT DO NOTHING;
