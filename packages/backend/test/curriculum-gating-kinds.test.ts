// Evaluation-kind-aware gating (Prompt 5 Phase C, §1.9). A module unlocks the
// next per its evaluation_kind; the hard-lock invariant still holds; and the
// engagement Cᵢ denominator tracks the live published-module count.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEnrollment, createModule, addQuestion } from "./helpers/factories.js";
import { loadEnrollment, loadModule, isModuleUnlocked } from "../src/modules/progress/gating.js";
import { EngagementService } from "../src/modules/engagement/service.js";

let userId: string;
let enr: string;

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  userId = (await createUser({ congregationId: cong })).user_id;
  enr = await createEnrollment(userId, 1);
});
afterAll(async () => {
  await closeTestPool();
});

async function complete(moduleId: string, reflection?: string): Promise<void> {
  await testPool().query(
    `INSERT INTO module_progress (enrollment_id, module_id, is_completed, reflection_text)
     VALUES ($1,$2,TRUE,$3)`,
    [enr, moduleId, reflection ?? null],
  );
}
async function passQuiz(moduleId: string): Promise<void> {
  await testPool().query(
    `INSERT INTO quiz_attempts (progress_id, score_achieved, is_passed, question_set)
     SELECT progress_id, 100, TRUE, '[]'::jsonb FROM module_progress
      WHERE enrollment_id = $1 AND module_id = $2`,
    [enr, moduleId],
  );
}
async function unlocked(moduleId: string): Promise<boolean> {
  const e = await loadEnrollment(testPool(), userId);
  const m = await loadModule(testPool(), moduleId);
  return isModuleUnlocked(testPool(), e!, m!);
}

describe("gating by evaluation_kind (§1.9)", () => {
  it("'none' module unlocks the next on completion alone", async () => {
    const m1 = await createModule(1, 1, { evaluationKind: "none" });
    const m2 = await createModule(1, 2, { evaluationKind: "none" });
    expect(await unlocked(m2)).toBe(false);
    await complete(m1);
    expect(await unlocked(m2)).toBe(true);
  });

  it("'reflection' module needs completion + an unreturned reflection (B3 model)", async () => {
    const m1 = await createModule(1, 1, { evaluationKind: "reflection" });
    const m2 = await createModule(1, 2, { evaluationKind: "none" });
    await complete(m1); // completed but no reflection
    expect(await unlocked(m2)).toBe(false);

    // The real write path inserts a reviewable module_reflections row (pending).
    await testPool().query(
      `INSERT INTO module_reflections (progress_id, user_id, module_id, body)
       SELECT progress_id, $1, $2, 'I learned much' FROM module_progress
        WHERE enrollment_id = $3 AND module_id = $2`,
      [userId, m1, enr],
    );
    expect(await unlocked(m2)).toBe(true); // pending passes

    await testPool().query(`UPDATE module_reflections SET state = 'returned' WHERE module_id = $1`, [m1]);
    expect(await unlocked(m2)).toBe(false); // returned re-locks
  });

  it("'quiz' module still needs a passing attempt", async () => {
    const m1 = await createModule(1, 1, { evaluationKind: "quiz" });
    await addQuestion(m1, "A");
    const m2 = await createModule(1, 2, { evaluationKind: "none" });
    await complete(m1);
    expect(await unlocked(m2)).toBe(false);
    await passQuiz(m1);
    expect(await unlocked(m2)).toBe(true);
  });

  it("hard-lock invariant: nothing above current_level unlocks", async () => {
    const l2m1 = await createModule(2, 1, { evaluationKind: "none" });
    expect(await unlocked(l2m1)).toBe(false); // enrollment is at level 1
  });
});

describe("engagement Cᵢ uses the live published-module count (§1.8)", () => {
  it("publishing more modules raises the denominator and lowers Cᵢ", async () => {
    await createModule(1, 1, { evaluationKind: "none" }); // published
    const m2 = await createModule(1, 2, { evaluationKind: "none" });
    await complete(m2); // 1 completed module
    const svc = new EngagementService(testPool());

    await svc.recomputeAll();
    const c1 = await testPool().query("SELECT c_score FROM engagement_scores WHERE user_id=$1", [userId]);
    expect(Number(c1.rows[0].c_score)).toBeCloseTo(0.5, 3); // 1 / 2 published

    await createModule(1, 3, { evaluationKind: "none" }); // now 3 published
    await svc.recomputeAll();
    const c2 = await testPool().query("SELECT c_score FROM engagement_scores WHERE user_id=$1", [userId]);
    expect(Number(c2.rows[0].c_score)).toBeCloseTo(1 / 3, 3); // denominator grew
  });
});
