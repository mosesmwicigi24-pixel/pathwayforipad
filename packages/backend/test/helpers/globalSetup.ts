// Vitest globalSetup: boot a single embedded PostgreSQL for the whole run,
// apply all §2 migrations and the seeds, expose its DSN via a fixed port so test
// workers connect to the same instance. Teardown stops it.
import EmbeddedPostgres from "embedded-postgres";
import migrationRunner from "node-pg-migrate";
import pg from "pg";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, "..", "..");
export const TEST_PG_PORT = 55432;
export const TEST_DATABASE_URL = `postgres://nuru:nuru@localhost:${TEST_PG_PORT}/nuru_test`;

let epg: EmbeddedPostgres;

export async function setup(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "nuru-pg-"));
  epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "nuru",
    password: "nuru",
    port: TEST_PG_PORT,
    persistent: false,
  });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase("nuru_test");

  await migrationRunner({
    databaseUrl: TEST_DATABASE_URL,
    dir: join(backendRoot, "migrations"),
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: () => {},
  });

  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  const seedDir = join(backendRoot, "seeds");
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith(".sql") && !f.includes("placeholder")).sort()) {
    await c.query(readFileSync(join(seedDir, f), "utf8"));
  }
  await c.end();
}

export async function teardown(): Promise<void> {
  if (epg) await epg.stop();
}
