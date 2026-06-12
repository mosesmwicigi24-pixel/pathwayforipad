-- Seed · Spiritual-gifts assessment bank + serving tracks (Contract Matrix B6).
-- Likert items (1 Rarely … 5 Strongly agree), three per gift. Idempotent on the
-- stable code / track_key.

INSERT INTO gift_questions (code, gift_key, prompt, sort) VALUES
  ('lead_1',  'leadership',  'People naturally look to me for direction when a group needs to move forward.', 1),
  ('lead_2',  'leadership',  'I enjoy setting a vision and organising people to reach it.', 2),
  ('lead_3',  'leadership',  'I am comfortable making decisions that affect a whole group.', 3),
  ('teach_1', 'teaching',    'I love explaining Scripture in a way that makes it click for others.', 4),
  ('teach_2', 'teaching',    'I find myself breaking big truths into simple steps people can follow.', 5),
  ('teach_3', 'teaching',    'People tell me they understand the Word better after we talk.', 6),
  ('serve_1', 'service',     'I notice practical needs before most people do and act on them.', 7),
  ('serve_2', 'service',     'I would rather work behind the scenes than be on the platform.', 8),
  ('serve_3', 'service',     'Helping with setup, logistics or errands energises me.', 9),
  ('mercy_1', 'mercy',       'I am drawn to people who are hurting and want to sit with them.', 10),
  ('mercy_2', 'mercy',       'I can sense how someone is really feeling even when they hide it.', 11),
  ('mercy_3', 'mercy',       'Visiting the sick, grieving or struggling feels like my place.', 12),
  ('evang_1', 'evangelism',  'I look for natural openings to share the gospel with people I meet.', 13),
  ('evang_2', 'evangelism',  'I get energised talking about Jesus with people far from church.', 14),
  ('evang_3', 'evangelism',  'I regularly pray for and pursue specific people to come to faith.', 15),
  ('give_1',  'giving',      'I joyfully give beyond my tithe when I see a kingdom need.', 16),
  ('give_2',  'giving',      'I see my income as a tool God uses to fund His work.', 17),
  ('give_3',  'giving',      'I often feel led to meet a financial need quietly.', 18),
  ('hosp_1',  'hospitality', 'I love making newcomers feel at home, in church or in my house.', 19),
  ('hosp_2',  'hospitality', 'Hosting people — meals, lodging, gatherings — comes naturally to me.', 20),
  ('hosp_3',  'hospitality', 'I notice the person standing alone and go to include them.', 21)
ON CONFLICT (code) DO NOTHING;

INSERT INTO serving_tracks (track_key, title, description, gift_keys) VALUES
  ('cell_leadership',   'Cell Group Leadership',  'Lead a cell group on the multiplication pathway — shepherd members and raise new leaders.', ARRAY['leadership','teaching']),
  ('teaching_team',     'Teaching & Discipleship', 'Teach pathway classes, lead module discussions and mentor new believers.',                ARRAY['teaching','leadership']),
  ('care_visitation',   'Care & Visitation',      'Visit the sick, follow up the struggling and carry the church''s pastoral heart.',        ARRAY['mercy','service']),
  ('outreach_missions', 'Outreach & Missions',    'Take the gospel out — community outreach, missions trips and follow-up of new converts.', ARRAY['evangelism','mercy']),
  ('welcome_team',      'Welcome & Hospitality',  'Be the first face people meet — ushering, protocol, new-member welcome and follow-up.',   ARRAY['hospitality','service']),
  ('serve_ops',         'Service & Operations',   'Keep gatherings running — setup, logistics, media and the practical backbone of ministry.', ARRAY['service','giving']),
  ('kingdom_partners',  'Kingdom Partnership',    'Fuel the mission — strategic generosity, project funding and stewardship of resources.',   ARRAY['giving','leadership'])
ON CONFLICT (track_key) DO NOTHING;
