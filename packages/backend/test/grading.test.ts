// Unit tests for quiz/exam grading (§1.3). Pure — no DB. Guards the regression
// where structured-choice questions scored 0% because the client submits the
// chosen option's id while correct_answer stored the option text.
import { describe, it, expect } from "vitest";
import { gradeSubmission, type GradableQuestion } from "../src/modules/assessment/grading.js";

const choice = (id: string, text: string, is_correct = false) => ({ id, text, is_correct });

describe("gradeSubmission — structured choices (id-or-text)", () => {
  const mc: GradableQuestion = {
    question_id: "q1",
    q_type: "multiple_choice",
    correct_answer: "The living body of Christ", // text key
    points: 1,
    answer_options: { choices: [choice("opt-a", "A building", false), choice("opt-b", "The living body of Christ", true)] },
  };

  it("scores 100% when the submitted ID matches the correct choice (real mobile flow)", () => {
    const out = gradeSubmission([mc], new Map([["q1", "opt-b"]]));
    expect(out.score).toBe(100);
    expect(out.graded[0]?.is_correct).toBe(true);
  });

  it("scores 0% for a wrong ID", () => {
    expect(gradeSubmission([mc], new Map([["q1", "opt-a"]])).score).toBe(0);
  });

  it("still accepts the correct TEXT (back-compat)", () => {
    expect(gradeSubmission([mc], new Map([["q1", "The living body of Christ"]])).score).toBe(100);
  });

  it("checkbox: full marks only when the submitted id-set equals the correct id-set", () => {
    const cb: GradableQuestion = {
      question_id: "q2",
      q_type: "checkbox",
      correct_answer: JSON.stringify(["X", "Y"]),
      points: 1,
      answer_options: { choices: [choice("o1", "X", true), choice("o2", "Y", true), choice("o3", "Z", false)] },
    };
    expect(gradeSubmission([cb], new Map([["q2", JSON.stringify(["o1", "o2"])]])).score).toBe(100);
    expect(gradeSubmission([cb], new Map([["q2", JSON.stringify(["o1"])]])).score).toBe(0); // incomplete
    expect(gradeSubmission([cb], new Map([["q2", JSON.stringify(["o1", "o2", "o3"])]])).score).toBe(0); // extra
  });

  it("legacy string options (no answer_options): exact text match still grades", () => {
    const legacy: GradableQuestion = { question_id: "q3", q_type: "MultipleChoice", correct_answer: "True", points: 1 };
    expect(gradeSubmission([legacy], new Map([["q3", "True"]])).score).toBe(100);
    expect(gradeSubmission([legacy], new Map([["q3", "False"]])).score).toBe(0);
  });

  it("points-weighted across a mixed set", () => {
    const q: GradableQuestion[] = [
      { ...mc, question_id: "a", points: 2 },
      { ...mc, question_id: "b", points: 1 },
    ];
    // a correct (2 pts), b wrong (0) → 2/3 = 66.67
    const out = gradeSubmission(q, new Map([["a", "opt-b"], ["b", "opt-a"]]));
    expect(out.score).toBe(66.67);
  });
});
