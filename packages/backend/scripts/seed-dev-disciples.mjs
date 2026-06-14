// Dev-only sample disciples — populates the Yukos cell with a handful of Student
// accounts at varied levels/progress + engagement bands, so the Members roster,
// Cell Engagement, and dashboards look alive in local dev. Idempotent (upsert by
// email). NOT loaded by tests or prod seeds. Run: node scripts/seed-dev-disciples.mjs
import "dotenv/config";
import pg from "pg";
import argon2 from "argon2";

const CELL_NAME = "Yukos";
const PASSWORD = "discipleship123";
// name, email, level, modulesDone (in their level), band, e_score
const PEOPLE = [
  ["Esther Njoroge", "esther.njoroge@disciple.dev", 1, 6, "thriving", 0.82],
  ["Brian Otieno", "brian.otieno@disciple.dev", 1, 2, "watch", 0.41],
  ["Naomi Karanja", "naomi.karanja@disciple.dev", 2, 4, "steady", 0.66],
  ["Samuel Achieng", "samuel.achieng@disciple.dev", 1, 9, "thriving", 0.9],
  ["Lydia Akinyi", "lydia.akinyi@disciple.dev", 2, 1, "at_risk", 0.23],
  ["Peter Kamau", "peter.kamau@disciple.dev", 3, 3, "steady", 0.6],
  ["Ann Mwende", "ann.mwende@disciple.dev", 1, 4, "steady", 0.55],
];
const BAND_SCORES = { thriving: [0.85, 0.85, 0.9], steady: [0.6, 0.6, 0.65], watch: [0.4, 0.45, 0.4], at_risk: [0.2, 0.25, 0.2] };

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await c.query("BEGIN");
  const cong = (await c.query("SELECT congregation_id FROM congregations ORDER BY created_at LIMIT 1")).rows[0].congregation_id;
  let cell = (await c.query("SELECT cell_group_id FROM cell_groups WHERE congregation_id=$1 AND name=$2", [cong, CELL_NAME])).rows[0];
  if (!cell) cell = (await c.query("INSERT INTO cell_groups (congregation_id, name) VALUES ($1,$2) RETURNING cell_group_id", [cong, CELL_NAME])).rows[0];
  const cellId = cell.cell_group_id;

  let n = 0;
  for (const [name, email, level, done, band, e] of PEOPLE) {
    let u = (await c.query("SELECT user_id FROM users WHERE email=$1", [email])).rows[0];
    if (u) {
      await c.query(`UPDATE users SET full_name=$2, cell_group_id=$3, congregation_id=$4, role='Student', country_code='KE',
          locale='en', account_status='active', password_hash=$5, is_baptized=TRUE, deleted_at=NULL, updated_at=now() WHERE user_id=$1`,
        [u.user_id, name, cellId, cong, hash]);
    } else {
      u = (await c.query(`INSERT INTO users (full_name, email, password_hash, phone_number, date_of_birth, congregation_id,
            cell_group_id, role, country_code, locale, account_status, is_baptized)
          VALUES ($1,$2,$3,'+254700000000','1995-01-01',$4,$5,'Student','KE','en','active',TRUE) RETURNING user_id`,
        [name, email, hash, cong, cellId])).rows[0];
    }
    const uid = u.user_id;
    await c.query("INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1,'member') ON CONFLICT DO NOTHING", [uid]);

    let enr = (await c.query("SELECT enrollment_id FROM enrollments WHERE user_id=$1", [uid])).rows[0];
    if (!enr) enr = (await c.query("INSERT INTO enrollments (user_id, current_level, state, started_at) VALUES ($1,$2,'active',now()) RETURNING enrollment_id", [uid, level])).rows[0];
    else await c.query("UPDATE enrollments SET current_level=$2 WHERE enrollment_id=$1", [enr.enrollment_id, level]);

    const mods = (await c.query("SELECT module_id, module_sequence_number seq FROM modules WHERE level_number=$1 ORDER BY seq", [level])).rows;
    for (const m of mods) {
      if (m.seq > done) break;
      await c.query(
        `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1,$2,TRUE,now())
           ON CONFLICT (enrollment_id, module_id) DO UPDATE SET is_completed=TRUE, completed_at=now()`,
        [enr.enrollment_id, m.module_id],
      );
    }

    const [h, a2, cscore] = BAND_SCORES[band];
    await c.query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7::engagement_band,CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET cell_group_id=EXCLUDED.cell_group_id, h_score=EXCLUDED.h_score,
         c_score=EXCLUDED.c_score, a_score=EXCLUDED.a_score, e_score=EXCLUDED.e_score, band=EXCLUDED.band, window_end=EXCLUDED.window_end`,
      [uid, cellId, h, cscore, a2, e, band],
    );
    n++;
  }
  await c.query("COMMIT");
  console.log(`Seeded ${n} sample disciples into the ${CELL_NAME} cell (password: ${PASSWORD}).`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
