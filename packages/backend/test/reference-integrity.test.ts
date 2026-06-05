// Reference-integrity check (spec §2.6): the seed must produce exactly 5 levels
// and 45 modules with contiguous sequence numbers — the gating engine depends on
// that contiguity. The 45-module seed is a placeholder pending the PRD curriculum
// appendix, so the module assertions are skipped until real content is loaded.
// The levels assertion runs whenever DATABASE_URL is set.
import { describe, it, expect } from "vitest";
import pg from "pg";

const DB = process.env.DATABASE_URL;
const maybe = DB ? describe : describe.skip;

maybe("seed reference integrity", () => {
  it("loads exactly 5 levels", async () => {
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    try {
      const { rows } = await client.query<{ n: string }>("SELECT count(*)::text n FROM levels");
      expect(Number(rows[0]?.n)).toBe(5);
    } finally {
      await client.end();
    }
  });

  // Unskip once seeds/03_modules.sql is populated from the PRD curriculum appendix.
  it.skip("loads exactly 45 modules with contiguous sequence numbers per level", async () => {
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    try {
      const total = await client.query<{ n: string }>("SELECT count(*)::text n FROM modules");
      expect(Number(total.rows[0]?.n)).toBe(45);

      const gaps = await client.query(
        `SELECT level_number FROM modules
         GROUP BY level_number
         HAVING max(module_sequence_number) <> count(*)
            OR min(module_sequence_number) <> 1`,
      );
      expect(gaps.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
