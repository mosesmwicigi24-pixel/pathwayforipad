// Per-test database access: a shared pool against the embedded Postgres from
// globalSetup, plus resetDb() to truncate between tests and re-apply seeds.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "..", "seeds");
const TEST_DATABASE_URL = "postgres://nuru:nuru@localhost:55432/nuru_test";

let pool: pg.Pool | null = null;

export function testPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Truncate all data tables (keep schema), then re-apply the level/fund seeds. */
export async function resetDb(): Promise<void> {
  const p = testPool();
  const { rows } = await p.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname='public' AND tablename NOT IN ('pgmigrations')
       AND tablename NOT LIKE 'interaction_events_%'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (tables) await p.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith(".sql") && !f.includes("placeholder")).sort()) {
    await p.query(readFileSync(join(seedDir, f), "utf8"));
  }
}
