// Seed runner (spec §2.6). Applies the idempotent SQL seeds in order against
// DATABASE_URL. Loads the five levels and four core funds. The 45-module seed is
// a documented placeholder pending the PRD curriculum appendix (see seeds/).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "seeds");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const files = readdirSync(seedDir)
  .filter((f) => f.endsWith(".sql") && !f.includes("placeholder"))
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of files) {
    const sql = readFileSync(join(seedDir, f), "utf8");
    await client.query(sql);
    console.warn(`seeded: ${f}`);
  }
} finally {
  await client.end();
}
