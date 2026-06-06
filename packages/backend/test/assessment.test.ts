// Assessment — server-side quiz assembly + scoring (§1.9, §3.3, §3.7).
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
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ProgressService } from "../src/modules/progress/service.js";

const assess = () => new AssessmentService(testPool());
const progress = () => new ProgressService(testPool());

const MUT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("assessment / quiz (§1.9, §3.7)", () => {
  let userId: string;
  let l1m1: string, l1m2: string, q1: string, q2: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(userId, 1);
    l1m1 = await createModule(1, 1, { quizPassMark: 70 });
    l1m2 = await createModule(1, 2);
    q1 = await addQuestion(l1m1, "A");
    q2 = await addQuestion(l1m1, "B");
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("assembles a quiz without leaking correct answers", async () => {
    const quiz = (await assess().assembleQuiz(userId, l1m1)) as {
      question_count: number;
      questions: Array<Record<string, unknown>>;
    };
    expect(quiz.question_count).toBe(2);
    for (const q of quiz.questions) {
      expect(q).toHaveProperty("question_id");
      expect(q).toHaveProperty("answer_options");
      expect(q).not.toHaveProperty("correct_answer"); // §5.8
    }
  });

  it("scores a fully-correct submission as 100 and passing", async () => {
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [
        { question_id: q1, given_answer: "A" },
        { question_id: q2, given_answer: "b" }, // case-insensitive
      ],
    });
    expect(res.score_achieved).toBe(100);
    expect(res.is_passed).toBe(true);
    expect(res.pass_mark).toBe(70);
  });

  it("fails a half-correct submission below the pass mark (unanswered = wrong)", async () => {
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }], // q2 omitted → wrong
    });
    expect(res.score_achieved).toBe(50);
    expect(res.is_passed).toBe(false);
  });

  it("is idempotent on client_mutation_id", async () => {
    const first = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(first.duplicate).toBe(false);
    const again = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(again.duplicate).toBe(true);
    expect(again.attempt_id).toBe(first.attempt_id);
    const { rows } = await testPool().query(`SELECT count(*)::int n FROM quiz_attempts`);
    expect(rows[0].n).toBe(1);
  });

  it("refuses quiz actions on a locked module (§1.9 hard lock)", async () => {
    await expect(assess().assembleQuiz(userId, l1m2)).rejects.toMatchObject({ code: "GATE_LOCKED" });
    await expect(
      assess().submitQuiz(userId, l1m2, { client_mutation_id: MUT, answers: [{ question_id: q1, given_answer: "A" }] }),
    ).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("passing the quiz of a completed module unlocks the next (Flow A)", async () => {
    await progress().completeModule(userId, l1m1, null); // mark complete first
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(res.is_passed).toBe(true);
    expect(res.unlocked_next_module_id).toBe(l1m2);
  });
});
