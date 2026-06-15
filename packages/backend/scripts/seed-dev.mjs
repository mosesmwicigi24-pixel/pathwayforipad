// DEV-ONLY seed (separate from the production seeds in seeds/, which stay
// untouched: 5 levels + 4 funds). Creates a small, deterministic dataset so the
// multiplier cohort table shows a spread of engagement bands, and dev-login has
// real users to mint sessions for. Idempotent: re-running wipes the prior dev
// dataset first. Run with `pnpm --filter @nuru/backend run seed:dev` against your
// local DATABASE_URL. NEVER run against production.
import pg from "pg";
import argon2 from "argon2";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Each student's signal → drives a distinct band via the §1.8 aggregation, so the
// cohort spans thriving → at_risk.
const STUDENTS = [
  { name: "Ada Thriving", email: "student1@dev.local", days: 25, modules: 20, attend: 8 },
  { name: "Ben Steady", email: "student2@dev.local", days: 20, modules: 14, attend: 6 },
  { name: "Cara Watch", email: "student3@dev.local", days: 14, modules: 8, attend: 4 },
  { name: "Dee Watch", email: "student4@dev.local", days: 12, modules: 7, attend: 4 },
  { name: "Eli AtRisk", email: "student5@dev.local", days: 6, modules: 2, attend: 1 },
  { name: "Fay Silent", email: "student6@dev.local", days: 0, modules: 0, attend: 0 },
];
const DEV_MODULES = 20; // dev curriculum modules to complete against
const DEV_EVENTS = 8; // dev events to check in against
const DEV_PASSWORD = "pathway123"; // shared password for every @dev.local account (local only)

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");

  // --- wipe any prior dev dataset (order respects FKs) ---
  // Cover the current + any legacy dev email patterns; deleting users cascades
  // their progress/attendance/etc. Then clear dev-module progress explicitly
  // before removing the dev modules (belt-and-suspenders against FK restrict).
  await client.query(`DELETE FROM users WHERE email LIKE '%@dev.local' OR email LIKE 'dev+%@nuru.test'`);
  await client.query(
    `DELETE FROM module_progress WHERE module_id IN (SELECT module_id FROM modules WHERE title LIKE 'Dev Module %')`,
  );
  await client.query(`DELETE FROM modules WHERE title LIKE 'Dev Module %'`);
  await client.query(`DELETE FROM events WHERE event_id LIKE 'dev-evt-%'`);
  await client.query(`DELETE FROM cell_groups WHERE name LIKE 'Dev Cell %'`);
  await client.query(`DELETE FROM congregations WHERE name = 'Dev Branch'`);

  const cong = (
    await client.query(`INSERT INTO congregations (name, country) VALUES ('Dev Branch','KE') RETURNING congregation_id`)
  ).rows[0].congregation_id;

  const cellA = (
    await client.query(
      `INSERT INTO cell_groups (congregation_id, name, meeting_cadence) VALUES ($1,'Dev Cell A',8) RETURNING cell_group_id`,
      [cong],
    )
  ).rows[0].cell_group_id;
  const cellB = (
    await client.query(
      `INSERT INTO cell_groups (congregation_id, name, meeting_cadence) VALUES ($1,'Dev Cell B',8) RETURNING cell_group_id`,
      [cong],
    )
  ).rows[0].cell_group_id;

  const mkUser = async (name, email, role, cell) =>
    (
      await client.query(
        `INSERT INTO users (full_name, email, phone_number, date_of_birth, congregation_id, cell_group_id, role)
         VALUES ($1,$2,$3,'1990-01-01',$4,$5,$6) RETURNING user_id`,
        [name, email, "+254700000000", cong, cell, role],
      )
    ).rows[0].user_id;

  const admin = await mkUser("Dev Admin", "admin@dev.local", "Admin", null);
  const instructor = await mkUser("Dev Leader", "leader@dev.local", "Instructor", cellB);
  await client.query(`INSERT INTO leader_assignments (leader_user_id, cell_group_id) VALUES ($1,$2)`, [
    instructor,
    cellA, // the leader oversees Cell A / "cell group 1" (where the students live)
  ]);

  // dev curriculum modules (level 1) to complete against, and dev events to attend.
  const moduleIds = [];
  for (let i = 1; i <= DEV_MODULES; i++) {
    const id = (
      await client.query(
        `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, quiz_pass_mark, evaluation_kind, status)
         VALUES (1, $1, $2, 'dev', 70, 'none', 'published') RETURNING module_id`,
        [100 + i, `Dev Module ${i}`], // seq 101+ to avoid clashing with any real curriculum
      )
    ).rows[0].module_id;
    moduleIds.push(id);
  }
  for (let i = 1; i <= DEV_EVENTS; i++) {
    await client.query(
      `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret)
       VALUES ($1,$2,$3,$4, now(), 'dev-qr')`,
      [`dev-evt-${i}`, cong, cellA, `Dev Event ${i}`],
    );
  }

  for (const s of STUDENTS) {
    const uid = await mkUser(s.name, s.email, "Student", cellA);
    const enrollment = (
      await client.query(`INSERT INTO enrollments (user_id, current_level) VALUES ($1,1) RETURNING enrollment_id`, [uid])
    ).rows[0].enrollment_id;
    for (let i = 0; i < s.modules; i++) {
      await client.query(
        `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1,$2,TRUE,now())`,
        [enrollment, moduleIds[i]],
      );
    }
    for (let d = 1; d <= s.days; d++) {
      await client.query(
        `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
         VALUES ($1,'lesson_open',(CURRENT_DATE - ($2 || ' days')::interval), gen_random_uuid())`,
        [uid, d],
      );
    }
    for (let e = 1; e <= s.attend; e++) {
      await client.query(
        `INSERT INTO attendance_logs (user_id, event_id, client_scan_id) VALUES ($1,$2,gen_random_uuid())`,
        [uid, `dev-evt-${e}`],
      );
    }
  }

  // Run the authoritative §2.5 aggregation → engagement_scores (so bands show).
  const agg = readFileSync(join(here, "..", "src", "db", "engagement-aggregation.sql"), "utf8").replace(/;\s*$/, "");
  await client.query(
    `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
     SELECT user_id, cell_group_id, h_score, c_score, a_score, e_score,
       (CASE WHEN e_score >= 0.75 THEN 'thriving'
             WHEN e_score >= 0.55 THEN 'steady'
             WHEN e_score >= 0.40 THEN 'watch'
             ELSE 'at_risk' END)::engagement_band,
       CURRENT_DATE
     FROM ( ${agg} ) agg
     ON CONFLICT (user_id) DO UPDATE SET
       cell_group_id = EXCLUDED.cell_group_id, h_score = EXCLUDED.h_score, c_score = EXCLUDED.c_score,
       a_score = EXCLUDED.a_score, e_score = EXCLUDED.e_score, band = EXCLUDED.band,
       window_end = EXCLUDED.window_end, computed_at = now()`,
  );

  // Give every dev account the same known password so the email/password login
  // (Figma "Log in") works out of the box in the simulator — not just dev-login.
  const devHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
  await client.query(`UPDATE users SET password_hash = $1 WHERE email LIKE '%@dev.local'`, [devHash]);

  await client.query("COMMIT");

  const bands = await client.query(
    `SELECT u.full_name, u.email, es.e_score, es.band
       FROM engagement_scores es JOIN users u ON u.user_id = es.user_id
      WHERE u.email LIKE '%@dev.local' ORDER BY es.e_score`,
  );
  console.warn("\nDev dataset seeded. Cell group 1 cohort (lowest engagement first):");
  for (const r of bands.rows) console.warn(`  ${r.e_score}  ${r.band.padEnd(9)}  ${r.full_name}`);
  console.warn("\nDev-login emails (password for all: " + DEV_PASSWORD + "):");
  console.warn("  admin@dev.local    (Admin — sees every cell)");
  console.warn("  leader@dev.local   (Instructor — sees cell group 1 only)");
  console.warn("  student1@dev.local … student6@dev.local");
  console.warn(`\nCell group 1 id (use in the portal): ${cellA}\nCell group 2 id: ${cellB}\n`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("dev seed failed:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
