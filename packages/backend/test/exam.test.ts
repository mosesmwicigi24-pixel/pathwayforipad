// Level exam — server-side scoring + the §1.9 rule-2 precondition.
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
import { ProgressService } from "../src/modules/progress/service.js";
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ExamService } from "../src/modules/assessment/exam.js";

const progress = () => new ProgressService(testPool());
const assess = () => new AssessmentService(testPool());
const exam = () => new ExamService(testPool());

const MUT = "12121212-3434-4565-8787-909090909090";

describe("level exam (§1.9 rule 2)", () => {
  let student: string, l1m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(student, 1);
    l1m1 = await createModule(1, 1);
    q = await addQuestion(l1m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function finishModules(): Promise<void> {
    await progress().completeModule(student, l1m1, null);
    await assess().submitQuiz(student, l1m1, {
      client_mutation_id: "77777777-7777-4777-8777-777777777777",
      answers: [{ question_id: q, given_answer: "A" }],
    });
  }

  it("is locked until every module in the level is finished", async () => {
    await expect(exam().assemble(student, 1)).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("assembles without leaking answers once the level is ready", async () => {
    await finishModules();
    const ex = (await exam().assemble(student, 1)) as {
      question_count: number;
      questions: Array<Record<string, unknown>>;
    };
    expect(ex.question_count).toBe(1);
    expect(ex.questions[0]).not.toHaveProperty("correct_answer");
  });

  it("scores a correct submission as passing and a wrong one as failing", async () => {
    await finishModules();
    const pass = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    expect(pass.score_achieved).toBe(100);
    expect(pass.is_passed).toBe(true);
  });

  it("fails a wrong submission", async () => {
    await finishModules();
    const fail = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "Z" }],
    });
    expect(fail.score_achieved).toBe(0);
    expect(fail.is_passed).toBe(false);
  });

  it("is idempotent on client_mutation_id", async () => {
    await finishModules();
    const first = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    const again = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    expect(again.duplicate).toBe(true);
    expect(again.exam_attempt_id).toBe(first.exam_attempt_id);
    const { rows } = await testPool().query("SELECT count(*)::int n FROM level_exam_attempts");
    expect(rows[0].n).toBe(1);
  });
});
