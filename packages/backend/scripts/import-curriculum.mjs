// One-time, idempotent curriculum importer (Prompt 5 Phase F).
//
//   pnpm --filter @nuru/backend import:curriculum [path-to-source]
//
// Ingests the PRD source ("DISCIPLESHIP CLASSES - FULL COURSE.pdf", or a .txt/.md
// dump of it) into DRAFT modules so an Admin reviews and publishes them via the
// CMS. Splits on "LEVEL n:" and "MODULE n:" markers. For Levels 1–2 the full
// lesson body is imported as Markdown; for Levels 3–6 only TITLES are imported
// (the source is an outline there). NO quiz questions are fabricated. Upserts by
// (level_number, module_sequence_number) so re-runs are safe. Best-effort — the
// imported drafts always need human cleanup in the editor.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = resolve(here, "..", "..", "..", "DISCIPLESHIP CLASSES - FULL COURSE.pdf");
const FULL_BODY_MAX_LEVEL = 2; // Levels 1–2 get full bodies; 3–6 are titles only.

const LEVEL_RE = /^\s*LEVEL\s+(\d+)\s*:?\s*(.*)$/i;
const MODULE_RE = /^\s*MODULE\s+(\d+)\s*:?\s*(.*)$/i;

/** Parse source text into [{ level, modules: [{ sequence, title, body }] }]. */
export function parseCurriculum(text) {
  const levels = new Map();
  let level = null;
  let mod = null;
  const flush = () => {
    if (level !== null && mod) {
      const bucket = levels.get(level) ?? [];
      bucket.push({ ...mod, body: mod.bodyLines.join("\n").trim() });
      levels.set(level, bucket);
    }
    mod = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const lvl = LEVEL_RE.exec(raw);
    if (lvl) {
      flush();
      level = Number(lvl[1]);
      if (!levels.has(level)) levels.set(level, []);
      continue;
    }
    const m = MODULE_RE.exec(raw);
    if (m && level !== null) {
      flush();
      const seq = (levels.get(level)?.length ?? 0) + 1; // contiguous per level
      mod = { sequence: seq, title: (m[2] || `Module ${seq}`).trim(), bodyLines: [] };
      continue;
    }
    if (mod) mod.bodyLines.push(raw);
  }
  flush();
  return [...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lvl, modules]) => ({ level: lvl, modules }));
}

async function extractText(path) {
  if (extname(path).toLowerCase() === ".pdf") {
    try {
      const { default: pdfParse } = await import("pdf-parse");
      const data = await pdfParse(readFileSync(path));
      return data.text;
    } catch {
      console.error(
        "PDF support needs the optional 'pdf-parse' dependency. Either `pnpm --filter @nuru/backend add -D pdf-parse`,\n" +
          "or pass a .txt/.md dump of the course instead.",
      );
      process.exit(1);
    }
  }
  return readFileSync(path, "utf8");
}

async function main() {
  const source = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SOURCE;
  if (!existsSync(source)) {
    console.warn(
      `Curriculum source not found at:\n  ${source}\n` +
        "Nothing imported. Provide the course PDF (or a .txt/.md dump) as the first argument:\n" +
        "  pnpm --filter @nuru/backend import:curriculum ./DISCIPLESHIP\\ CLASSES\\ -\\ FULL\\ COURSE.pdf",
    );
    process.exit(0);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const text = await extractText(source);
  const parsed = parseCurriculum(text);
  if (parsed.length === 0) {
    console.warn("No LEVEL/MODULE markers found — is this the right source file?");
    process.exit(0);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let levelsTouched = 0;
  let modulesUpserted = 0;
  try {
    for (const { level, modules } of parsed) {
      const lvl = await client.query("SELECT 1 FROM levels WHERE level_number = $1", [level]);
      if (lvl.rowCount === 0) {
        console.warn(`Skipping LEVEL ${level}: not seeded (create it in the CMS first).`);
        continue;
      }
      levelsTouched += 1;
      for (const m of modules) {
        const body = level <= FULL_BODY_MAX_LEVEL && m.body ? m.body : `# ${m.title}`;
        await client.query(
          `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, status)
           VALUES ($1,$2,$3,$4,'none','draft')
           ON CONFLICT (level_number, module_sequence_number) DO UPDATE
             SET title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content`,
          [level, m.sequence, m.title, body],
        );
        modulesUpserted += 1;
      }
    }
  } finally {
    await client.end();
  }

  console.warn(
    `Imported as DRAFT — levels: ${levelsTouched}, modules upserted: ${modulesUpserted}.\n` +
      "Best-effort import; review and publish each module in the Curriculum CMS. No quizzes were created.",
  );
}

// Only run the CLI when executed directly (keeps parseCurriculum importable/testable).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
