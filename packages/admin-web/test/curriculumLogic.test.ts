// Curriculum authoring logic (Prompt 5 Phase E) — pure validation + publish
// gating that the editor uses to surface inline errors and disable Publish.
import { describe, it, expect } from "vitest";
import { questionDraftErrors, publishBlockReason } from "../src/util/curriculumLogic";

describe("questionDraftErrors", () => {
  it("accepts a valid MultipleChoice question", () => {
    expect(
      questionDraftErrors({
        q_type: "MultipleChoice",
        question_text: "Pick A",
        answer_options: ["A", "B"],
        correct_answer: "A",
      }),
    ).toEqual([]);
  });

  it("flags MultipleChoice with <2 options and a correct answer not among them", () => {
    const errs = questionDraftErrors({
      q_type: "MultipleChoice",
      question_text: "Q",
      answer_options: ["A"],
      correct_answer: "Z",
    });
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it("flags TrueFalse whose answer isn't True/False, and empty FillInTheBlank", () => {
    expect(questionDraftErrors({ q_type: "TrueFalse", question_text: "Q", correct_answer: "Maybe" })).toContain(
      "Correct answer must be True or False.",
    );
    expect(questionDraftErrors({ q_type: "FillInTheBlank", question_text: "Q", correct_answer: "  " })).toContain(
      "A non-empty correct answer is required.",
    );
  });
});

describe("publishBlockReason", () => {
  it("blocks a quiz module with no questions, and while dirty", () => {
    expect(publishBlockReason({ evaluation_kind: "quiz", activeQuestionCount: 0, dirty: false })).toMatch(/quiz/i);
    expect(publishBlockReason({ evaluation_kind: "none", activeQuestionCount: 0, dirty: true })).toMatch(/save/i);
  });

  it("allows publishing a clean none/reflection module and a quiz with questions", () => {
    expect(publishBlockReason({ evaluation_kind: "none", activeQuestionCount: 0, dirty: false })).toBeNull();
    expect(publishBlockReason({ evaluation_kind: "quiz", activeQuestionCount: 3, dirty: false })).toBeNull();
  });
});
