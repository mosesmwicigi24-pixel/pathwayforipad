// Reference-integrity check (spec §2.6, Prompt 5 Phase A): the seed must produce
// the SIX PRD levels with their verbatim titles and the core funds (4 spec +
// mission/gift from Contract Matrix B7). Curriculum
// size is data-driven now (no magic 45), so instead of a module count we assert
// that every level's PUBLISHED module_sequence_numbers are contiguous from 1 —
// the gating engine depends on that contiguity.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPool, resetDb, closeTestPool } from "./helpers/db.js";
import { createModule } from "./helpers/factories.js";

const LEVEL_TITLES = [
  "Foundations of Faith",
  "Inner Transformation",
  "Foundations of Grace & Kingdom Perspective",
  "Life & Power of the Holy Spirit",
  "Kingdom Culture, Leadership & Multiplication",
  "Maturity, Platform, Multiplication & Legacy",
];

describe("seed reference integrity", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("loads the 6 PRD levels with verbatim titles", async () => {
    const { rows } = await testPool().query<{ level_number: number; title: string }>(
      "SELECT level_number, title FROM levels ORDER BY level_number",
    );
    expect(rows.map((r) => r.title)).toEqual(LEVEL_TITLES);
  });

  it("loads the core funds (incl. B7 mission/gift)", async () => {
    const { rows } = await testPool().query<{ code: string }>("SELECT code FROM funds ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual(["general", "gift", "media", "mission", "offering", "tithe"]);
  });

  it("every level's published module sequence is contiguous from 1 (no gaps)", async () => {
    // Author a small published set + a draft gap; the contiguity check ignores drafts.
    await createModule(1, 1, { published: true });
    await createModule(1, 2, { published: true });
    await createModule(1, 3, { published: false }); // draft — not part of the published run

    const { rows } = await testPool().query<{ level_number: number; seqs: number[] }>(
      `SELECT level_number, array_agg(module_sequence_number ORDER BY module_sequence_number) AS seqs
         FROM modules WHERE status = 'published'
        GROUP BY level_number`,
    );
    for (const { seqs } of rows) {
      expect(seqs).toEqual(seqs.map((_, idx) => idx + 1)); // 1,2,3,...
    }
  });
});
