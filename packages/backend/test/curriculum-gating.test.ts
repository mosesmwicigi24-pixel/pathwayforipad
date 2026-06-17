import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addQuestion,
} from "./helpers/factories.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";
import { ProgressService } from "../src/modules/progress/service.js";

const curriculum = () => new CurriculumService(testPool());
const progress = () => new ProgressService(testPool());

async function passQuiz(moduleId: string): Promise<void> {
  // Simulate the assessment module writing a passing attempt for the module.
  const { rows } = await testPool().query(
    `SELECT progress_id FROM module_progress WHERE module_id = $1`,
    [moduleId],
  );
  await testPool().query(
    `INSERT INTO quiz_attempts (progress_id, score_achieved, is_passed, question_set)
     VALUES ($1, 90, TRUE, '[]'::jsonb)`,
    [rows[0].progress_id],
  );
}

describe("curriculum + gating (§1.9)", () => {
  let userId: string;
  let l1m1: string, l1m2: string, l1m3: string, l2m1: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(userId, 1);
    l1m1 = await createModule(1, 1);
    l1m2 = await createModule(1, 2); // no questions → completion alone unlocks next
    l1m3 = await createModule(1, 3);
    l2m1 = await createModule(2, 1);
    await addQuestion(l1m1, "A"); // m1 has a quiz → must be passed to unlock m2
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("only the first module of the active level is initially unlocked", async () => {
    const mods = (await curriculum().listModulesForLevel(userId, 1)) as Array<{
      module_sequence_number: number;
      locked: boolean;
    }>;
    expect(mods.find((m) => m.module_sequence_number === 1)!.locked).toBe(false);
    expect(mods.find((m) => m.module_sequence_number === 2)!.locked).toBe(true);
    expect(mods.find((m) => m.module_sequence_number === 3)!.locked).toBe(true);
  });

  it("getModule on a locked module returns 409 GATE_LOCKED", async () => {
    await expect(curriculum().getModule(userId, l1m2)).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("completing a module with a quiz does NOT unlock the next until the quiz is passed", async () => {
    const res = await progress().completeModule(userId, l1m1, null);
    expect(res.is_completed).toBe(true);
    expect(res.next_module_unlocked).toBe(false); // m1 has an unpassed quiz
    await expect(curriculum().getModule(userId, l1m2)).rejects.toMatchObject({ code: "GATE_LOCKED" });

    await passQuiz(l1m1);
    // Now m2 is reachable.
    const m2 = (await curriculum().getModule(userId, l1m2)) as { locked: boolean };
    expect(m2.locked).toBe(false);
  });

  it("a module with no questions unlocks the next on completion alone", async () => {
    await progress().completeModule(userId, l1m1, null);
    await passQuiz(l1m1);
    const r2 = await progress().completeModule(userId, l1m2, null); // m2 has no questions
    expect(r2.next_module_unlocked).toBe(true);
    const m3 = (await curriculum().getModule(userId, l1m3)) as { locked: boolean };
    expect(m3.locked).toBe(false);
  });

  it("HARD LOCK: level-2 content is never unlocked for a level-1 member (§1.9)", async () => {
    await expect(curriculum().getModule(userId, l2m1)).rejects.toMatchObject({ code: "GATE_LOCKED" });
    const l2 = (await curriculum().listModulesForLevel(userId, 2)) as Array<{ locked: boolean }>;
    expect(l2.every((m) => m.locked)).toBe(true);
  });

  it("ENTRY POINT: Level 1 · Module 1 is open even without an enrollment, rest stays gated", async () => {
    const cong = await createCongregation();
    const newcomer = (await createUser({ congregationId: cong, email: "newcomer@dev.local" })).user_id;
    // No enrollment for this member — L1M1 must still be readable as the way in.
    const m1 = (await curriculum().getModule(newcomer, l1m1)) as { locked: boolean };
    expect(m1.locked).toBe(false);
    const mods = (await curriculum().listModulesForLevel(newcomer, 1)) as Array<{
      module_sequence_number: number;
      locked: boolean;
    }>;
    expect(mods.find((m) => m.module_sequence_number === 1)!.locked).toBe(false);
    expect(mods.find((m) => m.module_sequence_number === 2)!.locked).toBe(true);
    // The hard lock still holds — no higher module opens for a non-enrolled member.
    await expect(curriculum().getModule(newcomer, l2m1)).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("completeModule is idempotent on the client mutation id", async () => {
    const mut = "11111111-2222-3333-4444-555555555555";
    const first = await progress().completeModule(userId, l1m1, mut);
    expect(first.duplicate).toBe(false);
    const again = await progress().completeModule(userId, l1m1, mut);
    expect(again.duplicate).toBe(true);
    expect(again.progress_id).toBe(first.progress_id);
    const { rows } = await testPool().query(
      `SELECT count(*)::int n FROM module_progress WHERE module_id = $1`,
      [l1m1],
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects completing a locked module", async () => {
    await expect(progress().completeModule(userId, l1m2, null)).rejects.toMatchObject({
      code: "GATE_LOCKED",
    });
  });
});
