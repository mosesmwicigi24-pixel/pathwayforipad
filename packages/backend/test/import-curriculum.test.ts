// Curriculum importer parser (Prompt 5 Phase F) — pure text → levels/modules.
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs CLI module without types; we only use the pure parser.
import { parseCurriculum } from "../scripts/import-curriculum.mjs";

const SAMPLE = `
LEVEL 1: Foundations of Faith
MODULE 1: Who is Jesus
He is Lord.
More body text.
MODULE 2: The New Birth
Born again.

LEVEL 3: Grace
MODULE 1: Outline only title
some text that should be dropped for L3
`;

describe("parseCurriculum", () => {
  it("groups modules under levels with contiguous sequences and bodies", () => {
    const parsed = parseCurriculum(SAMPLE) as Array<{
      level: number;
      modules: Array<{ sequence: number; title: string; body: string }>;
    }>;
    expect(parsed.map((p) => p.level)).toEqual([1, 3]);

    const l1 = parsed.find((p) => p.level === 1)!;
    expect(l1.modules.map((m) => m.sequence)).toEqual([1, 2]);
    expect(l1.modules[0]!.title).toBe("Who is Jesus");
    expect(l1.modules[0]!.body).toContain("He is Lord.");
    expect(l1.modules[1]!.title).toBe("The New Birth");

    const l3 = parsed.find((p) => p.level === 3)!;
    expect(l3.modules[0]!.title).toBe("Outline only title");
  });
});
