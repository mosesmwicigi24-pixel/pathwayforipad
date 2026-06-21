// Dev-only mobile demo seed — populates the canonical mobile dev user
// (student1@dev.local / "Ada Thriving") with the per-user data that the mobile
// app reads, so EVERY screen shows live data from the DB on the simulator:
// achievements (streak + badges), mentor + note, gift assessment, prayer journal,
// saved verses, a banner announcement, and notifications. Idempotent (re-runnable).
// NOT loaded by tests or prod seeds. Run: node scripts/seed-mobile-demo.mjs
import "dotenv/config";
import pg from "pg";

const STUDENT = "student1@dev.local";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("BEGIN");
  const ada = (await c.query("SELECT user_id FROM users WHERE email=$1", [STUDENT])).rows[0];
  if (!ada) throw new Error(`${STUDENT} not found — run seed:dev first`);
  const uid = ada.user_id;
  const leader = (await c.query("SELECT user_id FROM users WHERE email='leader@dev.local'")).rows[0]?.user_id
    ?? (await c.query("SELECT user_id FROM users WHERE role IN ('Instructor','Admin','SuperAdmin') LIMIT 1")).rows[0].user_id;

  // Clear prior demo rows for a clean re-run.
  await c.query("DELETE FROM prayer_entries WHERE user_id=$1", [uid]);
  await c.query("DELETE FROM saved_verses WHERE user_id=$1", [uid]);
  await c.query("DELETE FROM gift_assessments WHERE user_id=$1", [uid]);
  await c.query("DELETE FROM mentor_notes WHERE user_id=$1", [uid]);
  await c.query("DELETE FROM notifications WHERE user_id=$1 AND template LIKE 'demo_%'", [uid]);
  await c.query("DELETE FROM announcements WHERE title='Sunday Gathering Moved to 9 AM'");

  // 1) Achievements — streak + badges.
  await c.query(
    `INSERT INTO user_streaks (user_id, current_streak_days, longest_streak_days, last_active_date)
       VALUES ($1, 12, 25, CURRENT_DATE)
     ON CONFLICT (user_id) DO UPDATE SET current_streak_days=12, longest_streak_days=25, last_active_date=CURRENT_DATE`,
    [uid],
  );
  for (const code of ["first_module", "modules_10", "streak_7"]) {
    await c.query(
      `INSERT INTO user_badges (user_id, badge_id, source)
         SELECT $1, badge_id, '{"event":"seed-mobile-demo"}'::jsonb FROM badges WHERE code=$2
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [uid, code],
    );
  }

  // 2) Mentor relationship + a note with an upcoming meeting.
  await c.query(
    `INSERT INTO relationship_tree (multiplier_id, disciple_id) VALUES ($1,$2)
     ON CONFLICT (disciple_id) DO UPDATE SET multiplier_id=EXCLUDED.multiplier_id`,
    [leader, uid],
  );
  await c.query(
    `INSERT INTO mentor_notes (user_id, mentor_user_id, topic, note, met_at, next_meeting_at)
       VALUES ($1,$2,'Walking in the Word','Encouraged Ada to keep the daily rhythm; reviewed Level 1 reflections.',
               now() - interval '6 days', now() + interval '4 days')`,
    [uid, leader],
  );

  // 3) Gift assessment (server stores scores + top gifts; /me/gifts reads the latest).
  await c.query(
    `INSERT INTO gift_assessments (user_id, scores, top_gifts)
       VALUES ($1, $2::jsonb, $3)`,
    [uid, JSON.stringify({ leadership: 82, teaching: 74, service: 68, mercy: 61, giving: 55, evangelism: 48, prophecy: 40 }),
      ["leadership", "teaching", "service"]],
  );

  // 4) Prayer journal.
  await c.query(
    `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(),$1,'Family','Praying for my parents to grow in faith and for peace at home.',FALSE),
              (gen_random_uuid(),$1,'Provision','Thanking God for a new opportunity at work.',TRUE)`,
    [uid],
  );

  // 5) Saved verses.
  await c.query(
    `INSERT INTO saved_verses (saved_verse_id, user_id, reference, version, verse_text, note)
       VALUES (gen_random_uuid(),$1,'Romans 12:2','KJV','And be not conformed to this world: but be ye transformed by the renewing of your mind...','My anchor for Level 2.'),
              (gen_random_uuid(),$1,'Psalm 119:105','KJV','Thy word is a lamp unto my feet, and a light unto my path.','Daily reminder.')`,
    [uid],
  );

  // 6) Banner announcement + delivery to Ada.
  const ann = (await c.query(
    `INSERT INTO announcements (title, body, channels, audience_kind, status, sent_at, banner_expires_at, created_by)
       VALUES ('Sunday Gathering Moved to 9 AM','This Sunday we gather at **9:00 AM** at The Good News Mission. Come early for prayer.',
               ARRAY['banner','push'],'all','sent', now(), now() + interval '14 days', $1)
     RETURNING announcement_id`,
    [leader],
  )).rows[0].announcement_id;
  await c.query(
    `INSERT INTO announcement_deliveries (announcement_id, user_id, channel, status, delivered_at)
       VALUES ($1,$2,'banner','delivered', now())
     ON CONFLICT (announcement_id, user_id, channel) DO NOTHING`,
    [ann, uid],
  );

  // 7) Notifications (sent + unread → drives the bell badge).
  await c.query(
    `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for, sent_at)
       VALUES ($1,'push','demo_reflection_reviewed', '{"module":"Identity in Christ"}'::jsonb,'sent', now()-interval '2 hours', now()-interval '2 hours'),
              ($1,'push','demo_streak_milestone', '{"days":12}'::jsonb,'sent', now()-interval '1 day', now()-interval '1 day')`,
    [uid],
  );

  // 8) Pathway trail encouragements (level-scoped, CMS-managed) — a couple per
  //    of the first levels so the module trail shows real motivational content.
  await c.query(`DELETE FROM level_encouragements WHERE body LIKE '[demo]%'`);
  await c.query(
    `INSERT INTO level_encouragements (level_number, after_module_sequence, kind, title, body, emoji, scripture_ref, sort_order)
       VALUES
         (1, 0, 'splash',  'You''ve begun',          '[demo] Heaven is cheering you on — one faithful step at a time.', '✨', NULL, 0),
         (1, 2, 'cheer',   'Keep climbing',          '[demo] Two modules in. Stay close to Jesus and keep going.',      '🔥', NULL, 0),
         (1, 4, 'note',    'A word for the road',    '[demo] Let endurance finish its work so you are mature and complete.', '📖', 'James 1:4', 0),
         (2, 0, 'splash',  'On holy ground',         '[demo] Inner transformation begins as you let Him reshape your heart.', '🕊️', NULL, 0),
         (2, 3, 'sticker', 'Celebrate the climb',    '[demo] You''re on a roll — He who began a good work will complete it.', '🎉', 'Philippians 1:6', 0)`,
  );

  await c.query("COMMIT");
  console.log(`Mobile demo seeded for ${STUDENT}: streak+badges, mentor, gift assessment, 2 prayers, 2 verses, 1 announcement, 2 notifications, 5 level encouragements.`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
