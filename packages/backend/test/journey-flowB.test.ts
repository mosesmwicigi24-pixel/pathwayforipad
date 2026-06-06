// Journey B (§1.10 Flow B): finish L1 → pass exam → submit reflection → pastor
// approves → current_level flips to 2 and the certificate issues via the outbox.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addQuestion,
  createLeaderAssignment,
} from "./helpers/factories.js";
import { ProgressService } from "../src/modules/progress/service.js";
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ExamService } from "../src/modules/assessment/exam.js";
import { ReflectionService } from "../src/modules/assessment/reflection.js";
import { OutboxWorker } from "../src/workers/outbox.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import type { AppContext } from "../src/http/context.js";
import type { Principal } from "../src/http/http.js";

const REFLECTION = "This level reshaped how I pray and study scripture every single morning.";

describe("Journey B — exam → reflection → approval → level-up + certificate (§1.10 Flow B)", () => {
  let student: string, instructor: string, m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Grad" })).user_id;
    instructor = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    await createEnrollment(student, 1);
    await createLeaderAssignment(instructor, cell);
    m1 = await createModule(1, 1); // single L1 module ⇒ finishing it completes the level
    q = await addQuestion(m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("advances the member to L2 and issues a certificate through the outbox", async () => {
    const answers = [{ question_id: q, given_answer: "A" }];
    await new ProgressService(testPool()).completeModule(student, m1, null);
    await new AssessmentService(testPool()).submitQuiz(student, m1, {
      client_mutation_id: "bbbb0001-0000-4000-8000-000000000001",
      answers,
    });
    const exam = await new ExamService(testPool()).submit(student, 1, {
      client_mutation_id: "bbbb0001-0000-4000-8000-000000000002",
      answers,
    });
    expect(exam.is_passed).toBe(true);

    const refl = new ReflectionService(testPool());
    const submitted = (await refl.submit(student, 1, REFLECTION)) as { review_id: string };

    const pastor: Principal = { userId: instructor, role: "Instructor", congregationId: "c" };
    const decision = await refl.decide(pastor, submitted.review_id, { decision: "approve" });
    expect(decision.leveled_up).toBe(true);

    const enr = await testPool().query("SELECT current_level FROM enrollments WHERE user_id=$1", [student]);
    expect(enr.rows[0].current_level).toBe(2);

    // The approval enqueued certificate.issue; the outbox worker issues it.
    const ctx = { env: testEnv(), db: { primary: testPool(), replica: testPool() } } as AppContext;
    const drained = await new OutboxWorker(testPool(), buildOutboxHandlers(ctx)).drainOnce();
    expect(drained.done).toBeGreaterThanOrEqual(1);

    const cert = await testPool().query(
      "SELECT count(*)::int n FROM certificates WHERE user_id=$1 AND level_number=1",
      [student],
    );
    expect(cert.rows[0].n).toBe(1);
  });
});
