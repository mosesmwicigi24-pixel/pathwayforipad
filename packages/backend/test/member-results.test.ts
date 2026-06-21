// Member results dossier aggregation: per-module best score, level module-average,
// level overall (modules + level exam as equal "papers"), and overall score.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { AdminOpsService } from "../src/modules/adminops/service.js";

const svc = () => new AdminOpsService(testPool());

async function progress(enrollmentId: string, moduleId: string, completed: boolean): Promise<string> {
  const { rows } = await testPool().query<{ progress_id: string }>(
    `INSERT INTO module_progress (enrollment_id, module_id, is_completed) VALUES ($1,$2,$3) RETURNING progress_id`,
    [enrollmentId, moduleId, completed],
  );
  return rows[0]!.progress_id;
}
async function attempt(progressId: string, score: number, passed: boolean, mid: string): Promise<void> {
  await testPool().query(
    `INSERT INTO quiz_attempts (progress_id, score_achieved, is_passed, question_set, client_mutation_id) VALUES ($1,$2,$3,'[]'::jsonb,$4)`,
    [progressId, score, passed, mid],
  );
}

describe("memberResults aggregation", () => {
  let userId: string;
  let enr: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    enr = await createEnrollment(userId, 1);
    const m1 = await createModule(1, 1);
    const m2 = await createModule(1, 2);
    await createModule(1, 3); // not attempted
    // m1: two attempts (50 then 70) → best 70; m2: 80
    const p1 = await progress(enr, m1, true);
    await attempt(p1, 50, false, "11111111-1111-1111-1111-111111111111");
    await attempt(p1, 70, true, "22222222-2222-2222-2222-222222222222");
    const p2 = await progress(enr, m2, true);
    await attempt(p2, 80, true, "33333333-3333-3333-3333-333333333333");
    // Level 1 exam: 90
    await testPool().query(
      `INSERT INTO level_exam_attempts (enrollment_id, level_number, score_achieved, is_passed, question_set, client_mutation_id)
       VALUES ($1,1,90,true,'[]'::jsonb,'44444444-4444-4444-4444-444444444444')`,
      [enr],
    );
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("computes per-module best score, level module-average, level overall, and overall", async () => {
    const r = (await svc().memberResults(userId)) as {
      summary: { avg_module_score: number | null; overall_score: number | null };
      levels: Array<{ level_number: number; module_average: number | null; level_score: number | null; exam: { score: number | null } | null; modules: Array<{ sequence: number; best_score: number | null }> }>;
    };
    const l1 = r.levels.find((l) => l.level_number === 1)!;
    const byseq = (n: number) => l1.modules.find((m) => m.sequence === n);

    expect(byseq(1)?.best_score).toBe(70); // max of 50/70
    expect(byseq(2)?.best_score).toBe(80);
    expect(byseq(3)?.best_score).toBeNull(); // not attempted

    expect(l1.module_average).toBe(75); // (70+80)/2
    expect(l1.exam?.score).toBe(90);
    expect(l1.level_score).toBe(81); // modules 75 ×0.6 + exam 90 ×0.4

    expect(r.summary.avg_module_score).toBe(75); // modules only
    expect(r.summary.overall_score).toBe(81); // mean of level marks (only L1 sat)
  });
});
