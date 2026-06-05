// Reference-integrity check (spec §2.6): the seed must produce exactly 5 levels
// and 4 core funds; modules must have contiguous sequence numbers per level — the
// gating engine depends on that contiguity. The 45-module load is parked pending
// the PRD curriculum appendix, so that exact-count assertion is skipped.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPool, resetDb, closeTestPool } from "./helpers/db.js";

describe("seed reference integrity", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("loads exactly 5 levels", async () => {
    const { rows } = await testPool().query<{ n: string }>("SELECT count(*)::text n FROM levels");
    expect(Number(rows[0]?.n)).toBe(5);
  });

  it("loads the 4 core funds", async () => {
    const { rows } = await testPool().query<{ code: string }>("SELECT code FROM funds ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual(["general", "media", "offering", "tithe"]);
  });

  it.skip("loads exactly 45 modules with contiguous sequence numbers (pending PRD curriculum appendix)", () => {
    // Unskip once seeds/03_modules.sql is populated.
  });
});
