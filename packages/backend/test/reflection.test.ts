// Reflection review + level transition (§1.9 rule 3, §3.3, §5.4).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
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
import type { Principal } from "../src/http/http.js";

const progress = () => new ProgressService(testPool());
const assess = () => new AssessmentService(testPool());
const exam = () => new ExamService(testPool());
const refl = () => new ReflectionService(testPool());

const principal = (userId: string, role: Principal["role"]): Principal => ({
  userId,
  role,
  congregationId: "c",
});

const TEXT = "This level reshaped how I pray and read scripture every morning.";

describe("reflection review + level transition (§1.9)", () => {
  let cong: string, cell: string, student: string, instructor: string, l1m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    instructor = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    await createEnrollment(student, 1);
    l1m1 = await createModule(1, 1);
    q = await addQuestion(l1m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // Bring the student to "level 1 finished + exam passed" (the reflection
  // precondition: all modules complete/passed AND the level exam passed, §1.9).
  async function finishLevel1(): Promise<void> {
    await progress().completeModule(student, l1m1, null);
    await assess().submitQuiz(student, l1m1, {
      client_mutation_id: "99999999-9999-4999-8999-999999999999",
      answers: [{ question_id: q, given_answer: "A" }],
    });
    await exam().submit(student, 1, {
      client_mutation_id: "88888888-8888-4888-8888-888888888888",
      answers: [{ question_id: q, given_answer: "A" }],
    });
  }

  it("refuses a reflection until the level's modules are finished", async () => {
    await expect(refl().submit(student, 1, TEXT)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("accepts a reflection once the level is finished and queues it pending", async () => {
    await finishLevel1();
    const row = (await refl().submit(student, 1, TEXT)) as { state: string; level_number: number };
    expect(row.state).toBe("pending");
    expect(row.level_number).toBe(1);
  });

  it("scopes the queue: assigned instructor sees it, unassigned does not", async () => {
    await finishLevel1();
    await refl().submit(student, 1, TEXT);

    const unassigned = (await refl().listPending(principal(instructor, "Instructor"))) as unknown[];
    expect(unassigned.length).toBe(0);

    await createLeaderAssignment(instructor, cell);
    const assigned = (await refl().listPending(principal(instructor, "Instructor"))) as Array<{
      user_id: string;
    }>;
    expect(assigned.map((r) => r.user_id)).toContain(student);
  });

  it("approval advances the member to the next level and enqueues the certificate", async () => {
    await finishLevel1();
    const sub = (await refl().submit(student, 1, TEXT)) as { review_id: string };
    await createLeaderAssignment(instructor, cell);

    const decision = await refl().decide(principal(instructor, "Instructor"), sub.review_id, {
      decision: "approve",
    });
    expect(decision.state).toBe("approved");
    expect(decision.leveled_up).toBe(true);

    const enr = await testPool().query("SELECT current_level FROM enrollments WHERE user_id=$1", [student]);
    expect(enr.rows[0].current_level).toBe(2);

    const ob = await testPool().query("SELECT count(*)::int n FROM outbox WHERE topic='certificate.issue'");
    expect(ob.rows[0].n).toBe(1);
  });

  it("rejection records feedback and does NOT advance the level", async () => {
    await finishLevel1();
    const sub = (await refl().submit(student, 1, TEXT)) as { review_id: string };
    await createLeaderAssignment(instructor, cell);
    const d = await refl().decide(principal(instructor, "Instructor"), sub.review_id, {
      decision: "reject",
      feedback_notes: "Please expand on application.",
    });
    expect(d.state).toBe("rejected");
    expect(d.leveled_up).toBe(false);
    const enr = await testPool().query("SELECT current_level FROM enrollments WHERE user_id=$1", [student]);
    expect(enr.rows[0].current_level).toBe(1);
  });

  it("an out-of-scope instructor cannot decide (§5.4)", async () => {
    await finishLevel1();
    const sub = (await refl().submit(student, 1, TEXT)) as { review_id: string };
    // instructor has NO assignment for the student's cell
    await expect(
      refl().decide(principal(instructor, "Instructor"), sub.review_id, { decision: "approve" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("a decided review cannot be decided again", async () => {
    await finishLevel1();
    const sub = (await refl().submit(student, 1, TEXT)) as { review_id: string };
    await createLeaderAssignment(instructor, cell);
    await refl().decide(principal(instructor, "Instructor"), sub.review_id, { decision: "approve" });
    await expect(
      refl().decide(principal(instructor, "Instructor"), sub.review_id, { decision: "reject" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
