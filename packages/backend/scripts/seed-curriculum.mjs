// Curriculum seed — loads the Nuru Discipleship Pathway (parsed from the church's
// "DISCIPLESHIP CLASSES - FULL COURSE" PDF into scripts/data/discipleship-curriculum.json).
// Sets Level 1-6 titles/themes, Level 1's full module content (published), and
// Levels 2-6 module shells (draft). Idempotent but DESTRUCTIVE for module rows:
// it replaces the modules under each seeded level (cascading their progress), so
// run it on a fresh DB or accept that learner module-progress for those levels
// resets. Run:  node scripts/seed-curriculum.mjs   (needs DATABASE_URL)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "data", "discipleship-curriculum.json"), "utf8"));

const LEVELS = {
  1: { title: "Foundations of Faith", theme: "Part 1 — Core Encounter: knowing God, salvation, identity, and first steps." },
  2: { title: "Inner Transformation & Kingdom Living", theme: "Part 2 — Formation: surrender, renewed mind, authority, and freedom." },
  3: { title: "Foundations of Grace & Kingdom Perspective", theme: "Identity, Salvation, Grace, and Kingdom Perspective." },
  4: { title: "Life & Power of the Holy Spirit", theme: "The Person, Fruit, and Gifts of the Spirit." },
  5: { title: "Kingdom Culture, Leadership & Multiplication", theme: "Relationships, Leadership, and Reproducing Disciples." },
  6: { title: "Maturity, Platform, Multiplication & Legacy", theme: "Advanced Track: interior life, multiplication, finishing well." },
};
const TITLE_OVERRIDE = { "1:2": "God's Plan for Humanity" };
const SMALL = new Set(["of", "the", "and", "in", "to", "for", "by", "a", "an", "or", "&", "but", "with", "as"]);
const titleCase = (s) => s.replace(/\s+/g, " ").trim().toLowerCase().split(" ")
  .map((w, i) => (i > 0 && SMALL.has(w)) ? w : w.replace(/^([(]?)([a-z])/, (_, p, c) => p + c.toUpperCase())).join(" ");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("BEGIN");
  for (const [num, meta] of Object.entries(LEVELS)) {
    await c.query("UPDATE levels SET title=$2, theme=$3, status='published' WHERE level_number=$1", [Number(num), meta.title, meta.theme]);
  }
  const fks = (await c.query(
    `SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='modules' AND ccu.column_name='module_id'`,
  )).rows;

  let inserted = 0;
  for (const num of Object.keys(data).map(Number).sort((a, b) => a - b)) {
    const ids = (await c.query("SELECT module_id FROM modules WHERE level_number=$1", [num])).rows.map((r) => r.module_id);
    if (ids.length) {
      for (const fk of fks) {
        if (fk.table_name === "interaction_events") await c.query(`UPDATE interaction_events SET ${fk.column_name}=NULL WHERE ${fk.column_name} = ANY($1)`, [ids]);
        else await c.query(`DELETE FROM ${fk.table_name} WHERE ${fk.column_name} = ANY($1)`, [ids]);
      }
      await c.query("DELETE FROM modules WHERE level_number=$1", [num]);
    }
    const published = num === 1;
    for (const m of data[num].modules) {
      const title = TITLE_OVERRIDE[`${num}:${m.seq}`] ?? titleCase(m.title);
      const body = (m.body && m.body.trim()) ? m.body.trim() : `${title} — outline to be added.`;
      const rich = num === 1 && m.seq <= 7;
      await c.query(
        `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind,
              quiz_pass_mark, status, difficulty, visibility, required)
            VALUES ($1,$2,$3,$4,$5,80.00,$6,'beginner','members',TRUE)`,
        [num, m.seq, title, body, rich ? "reflection" : "none", published ? "published" : "draft"],
      );
      inserted++;
    }
  }
  await c.query("COMMIT");
  console.log(`Curriculum seeded: ${inserted} modules across ${Object.keys(data).length} levels.`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
