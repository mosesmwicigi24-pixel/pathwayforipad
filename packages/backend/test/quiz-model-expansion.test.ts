// Quiz/question model expansion (Figma ModuleQuizBuilder) — backend coverage:
// the six Figma question types create/read/score correctly, checkbox multi-correct
// scoring is all-or-nothing, manual items (paragraph / keyless short_answer) never
// block §1.9 advancement, and a level exam passes with a mixed-type pool.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addTypedQuestion,
} from "./helpers/factories.js";
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ExamService } from "../src/modules/assessment/exam.js";
import { ProgressService } from "../src/modules/progress/service.js";

const assess = () => new AssessmentService(testPool());
const exam = () => new ExamService(testPool());
const progress = () => new ProgressService(testPool());
const auth = (t: string) => ({ Authorization: t });

let cong: string;
let adminTok: string;
let studentId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const cell = await createCellGroup(cong);
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const student = await createUser({ congregationId: cong, cellGroupId: cell, email: "s@dev.local" });
  studentId = student.user_id;
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  await createEnrollment(studentId, 1);
});
afterAll(async () => {
  await closeTestPool();
});

async function newModule(level: number, body: Record<string, unknown> = {}): Promise<string> {
  const res = await agent()
    .post("/v1/admin/modules")
    .set(auth(adminTok))
    .send({ level_number: level, title: "M", lesson_content: "hi", evaluation_kind: "quiz", ...body });
  expect(res.status).toBe(201);
  return res.body.module_id as string;
}

const u = (s: string): string => `00000000-0000-4000-8000-${s.padStart(12, "0")}`;

describe("authoring the six Figma question types (§5.8)", () => {
  it("creates + reads multiple_choice / checkbox / dropdown / short_answer / paragraph / linear_scale", async () => {
    const id = await newModule(1);
    const res = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({
        questions: [
          { q_type: "multiple_choice", question_text: "MC", options: [{ text: "A", is_correct: true }, { text: "B" }], points: 2 },
          { q_type: "checkbox", question_text: "CB", options: [{ text: "X", is_correct: true }, { text: "Y", is_correct: true }, { text: "Z" }] },
          { q_type: "dropdown", question_text: "DD", options: [{ text: "P" }, { text: "Q", is_correct: true }] },
          { q_type: "short_answer", question_text: "SA", correct_answer: "Grace" },
          { q_type: "paragraph", question_text: "Reflect" },
          { q_type: "linear_scale", question_text: "Scale", scale_min: 1, scale_max: 5, scale_min_label: "Low", scale_max_label: "High" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(6);

    const list = await agent().get(`/v1/admin/modules/${id}/questions`).set(auth(adminTok));
    const byType = Object.fromEntries(list.body.data.map((q: { q_type: string }) => [q.q_type, q]));

    // checkbox stores correct_answer as a JSON array set + structured choices.
    expect(JSON.parse(byType.checkbox.correct_answer).sort()).toEqual(["X", "Y"]);
    expect(byType.checkbox.answer_options.choices).toHaveLength(3);

    // linear_scale folds config into answer_options.scale; no correct key.
    expect(byType.linear_scale.answer_options.scale).toMatchObject({ min: 1, max: 5, min_label: "Low", max_label: "High" });
    expect(byType.linear_scale.correct_answer).toBe("");

    // paragraph is always manual (empty correct key).
    expect(byType.paragraph.correct_answer).toBe("");
    // short_answer keeps its key; multiple_choice keeps points + single correct.
    expect(byType.short_answer.correct_answer).toBe("Grace");
    expect(byType.multiple_choice.points).toBe(2);
    expect(byType.multiple_choice.correct_answer).toBe("A");
  });

  it("validates per type: checkbox needs ≥1 correct, single-select needs exactly one, scale needs min<max", async () => {
    const id = await newModule(1);
    const post = (q: Record<string, unknown>) =>
      agent().post(`/v1/admin/modules/${id}/questions`).set(auth(adminTok)).send({ questions: [q] });

    expect((await post({ q_type: "checkbox", question_text: "?", options: [{ text: "A" }, { text: "B" }] })).status).toBe(400);
    expect((await post({ q_type: "multiple_choice", question_text: "?", options: [{ text: "A", is_correct: true }, { text: "B", is_correct: true }] })).status).toBe(400);
    expect((await post({ q_type: "dropdown", question_text: "?", options: [{ text: "A" }] })).status).toBe(400);
    expect((await post({ q_type: "linear_scale", question_text: "?", scale_min: 5, scale_max: 5 })).status).toBe(400);
    // valid ones still pass
    expect((await post({ q_type: "checkbox", question_text: "?", options: [{ text: "A", is_correct: true }, { text: "B" }] })).status).toBe(201);
  });
});

describe("scoring the new types (§1.3 server-authoritative)", () => {
  it("does not leak is_correct flags at assembly (§5.8)", async () => {
    const m = await createModule(1, 1, { quizPassMark: 50 });
    await addTypedQuestion({
      moduleId: m,
      qType: "checkbox",
      correct: JSON.stringify(["A", "B"]),
      answerOptions: { choices: [{ id: "1", text: "A", is_correct: true }, { id: "2", text: "B", is_correct: true }, { id: "3", text: "C", is_correct: false }] },
    });
    const quiz = (await assess().assembleQuiz(studentId, m)) as { questions: Array<{ answer_options: { choices: unknown[] } }> };
    for (const c of quiz.questions[0]!.answer_options.choices as Array<Record<string, unknown>>) {
      expect(c).not.toHaveProperty("is_correct");
      expect(c).toHaveProperty("text");
    }
  });

  it("checkbox is all-or-nothing: exact correct set passes, a subset/superset fails", async () => {
    const m = await createModule(1, 1, { quizPassMark: 100 });
    const cb = await addTypedQuestion({
      moduleId: m,
      qType: "checkbox",
      correct: JSON.stringify(["A", "C"]),
      answerOptions: { choices: [{ text: "A", is_correct: true }, { text: "B", is_correct: false }, { text: "C", is_correct: true }] },
    });

    const exact = await assess().submitQuiz(studentId, m, { client_mutation_id: u("1"), answers: [{ question_id: cb, given_answer: JSON.stringify(["A", "C"]) }] });
    expect(exact.score_achieved).toBe(100);
    expect(exact.is_passed).toBe(true);

    const subset = await assess().submitQuiz(studentId, m, { client_mutation_id: u("2"), answers: [{ question_id: cb, given_answer: JSON.stringify(["A"]) }] });
    expect(subset.score_achieved).toBe(0);

    const superset = await assess().submitQuiz(studentId, m, { client_mutation_id: u("3"), answers: [{ question_id: cb, given_answer: JSON.stringify(["A", "B", "C"]) }] });
    expect(superset.score_achieved).toBe(0);
  });

  it("points are weighted; short_answer is CI-trim matched; linear_scale awards points if answered", async () => {
    const m = await createModule(1, 1, { quizPassMark: 60 });
    const mc = await addTypedQuestion({ moduleId: m, qType: "multiple_choice", correct: "A", answerOptions: { choices: [{ text: "A", is_correct: true }, { text: "B" }] }, points: 3 });
    const sa = await addTypedQuestion({ moduleId: m, qType: "short_answer", correct: "Grace", points: 1 });
    const ls = await addTypedQuestion({ moduleId: m, qType: "linear_scale", correct: "", answerOptions: { scale: { min: 1, max: 5, min_label: null, max_label: null } }, points: 1 });

    // MC(3) correct + SA(1) "  grace " CI-trim correct + LS(1) answered = 5/5 = 100.
    const all = await assess().submitQuiz(studentId, m, {
      client_mutation_id: u("a"),
      answers: [
        { question_id: mc, given_answer: "A" },
        { question_id: sa, given_answer: "  grace " },
        { question_id: ls, given_answer: "4" },
      ],
    });
    expect(all.score_achieved).toBe(100);

    // Only the 3-point MC correct → 3/5 = 60 → passes at 60.
    const partial = await assess().submitQuiz(studentId, m, {
      client_mutation_id: u("b"),
      answers: [{ question_id: mc, given_answer: "A" }],
    });
    expect(partial.score_achieved).toBe(60);
    expect(partial.is_passed).toBe(true);
  });

  it("manual items (paragraph / keyless short_answer) are excluded from auto pass/fail and flagged", async () => {
    const m = await createModule(1, 1, { quizPassMark: 100 });
    const mc = await addTypedQuestion({ moduleId: m, qType: "multiple_choice", correct: "A", answerOptions: { choices: [{ text: "A", is_correct: true }, { text: "B" }] }, points: 1 });
    const para = await addTypedQuestion({ moduleId: m, qType: "paragraph", correct: "", points: 5 });
    const keyless = await addTypedQuestion({ moduleId: m, qType: "short_answer", correct: "", points: 5 });

    const res = await assess().submitQuiz(studentId, m, {
      client_mutation_id: u("c"),
      answers: [
        { question_id: mc, given_answer: "A" },
        { question_id: para, given_answer: "A long thoughtful reflection." },
        { question_id: keyless, given_answer: "anything" },
      ],
    });
    // Only the 1-point MC counts toward the denominator → 1/1 = 100, passes.
    expect(res.score_achieved).toBe(100);
    expect(res.is_passed).toBe(true);
    expect(res.requires_manual_review).toBe(true);

    // The manual answers are still recorded for review.
    const { rows } = await testPool().query(
      `SELECT count(*)::int n FROM quiz_attempt_answers a
         JOIN quiz_attempts qa ON qa.attempt_id = a.attempt_id WHERE a.is_correct = FALSE`,
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("level exam passes with a mixed-type pool (§1.9 rule 2)", () => {
  it("scores a mixed multiple_choice + checkbox + linear_scale exam and advances", async () => {
    const m = await createModule(1, 1, { quizPassMark: 50 });
    // Single module so finishing it readies the level exam.
    const qmc = await addTypedQuestion({ moduleId: m, qType: "multiple_choice", correct: "A", answerOptions: { choices: [{ text: "A", is_correct: true }, { text: "B" }] } });

    // Module must be completed + quiz passed before the exam unlocks.
    await progress().completeModule(studentId, m, null);
    await assess().submitQuiz(studentId, m, { client_mutation_id: u("d"), answers: [{ question_id: qmc, given_answer: "A" }] });

    // Add the rest of the exam pool (drawn from the level's active questions).
    const qcb = await addTypedQuestion({ moduleId: m, qType: "checkbox", correct: JSON.stringify(["X", "Y"]), answerOptions: { choices: [{ text: "X", is_correct: true }, { text: "Y", is_correct: true }, { text: "Z" }] } });
    const qls = await addTypedQuestion({ moduleId: m, qType: "linear_scale", correct: "", answerOptions: { scale: { min: 1, max: 5, min_label: null, max_label: null } } });
    const qpara = await addTypedQuestion({ moduleId: m, qType: "paragraph", correct: "" });

    const pass = await exam().submit(studentId, 1, {
      client_mutation_id: u("e"),
      answers: [
        { question_id: qmc, given_answer: "A" },
        { question_id: qcb, given_answer: JSON.stringify(["Y", "X"]) }, // order-insensitive
        { question_id: qls, given_answer: "3" },
        { question_id: qpara, given_answer: "reflection" }, // manual, excluded
      ],
    });
    // 3 auto-gradable items all correct → 100; paragraph excluded but flagged.
    expect(pass.score_achieved).toBe(100);
    expect(pass.is_passed).toBe(true);
    expect(pass.requires_manual_review).toBe(true);
  });
});

describe("per-quiz reveal settings round-trip", () => {
  it("module quiz_show_answers / quiz_show_score and level exam settings persist", async () => {
    const id = await newModule(1);
    const mod = await agent().put(`/v1/admin/modules/${id}`).set(auth(adminTok)).send({ quiz_show_answers: false, quiz_show_score: false });
    expect(mod.status).toBe(200);
    expect(mod.body.quiz_show_answers).toBe(false);
    expect(mod.body.quiz_show_score).toBe(false);

    const lvl = await agent()
      .put("/v1/admin/levels/1/exam")
      .set(auth(adminTok))
      .send({ required_exam_pass_mark: 75, exam_show_answers: false, exam_shuffle: false });
    expect(lvl.status).toBe(200);
    expect(lvl.body.exam_show_answers).toBe(false);
    expect(lvl.body.exam_shuffle).toBe(false);
    expect(Number(lvl.body.required_exam_pass_mark)).toBe(75);
  });
});
