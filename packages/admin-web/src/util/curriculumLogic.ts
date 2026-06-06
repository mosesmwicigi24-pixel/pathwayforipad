// Pure authoring-logic helpers, mirrored from the server's validation (§5.8) so
// the editor can surface inline errors and disable Publish before round-tripping.
// The server remains authoritative — these are UX affordances only.
import type { EvaluationKind } from "../api/client";

export interface QuestionDraft {
  q_type: "MultipleChoice" | "TrueFalse" | "FillInTheBlank";
  question_text: string;
  answer_options?: string[];
  correct_answer: string;
}

/** Per-type validation errors for a single question draft (empty = valid). */
export function questionDraftErrors(q: QuestionDraft): string[] {
  const errors: string[] = [];
  if (!q.question_text.trim()) errors.push("Question text is required.");
  if (q.q_type === "MultipleChoice") {
    const opts = (q.answer_options ?? []).filter((o) => o.trim().length > 0);
    if (opts.length < 2) errors.push("Add at least 2 answer options.");
    if (!opts.includes(q.correct_answer)) errors.push("The correct answer must match one of the options.");
  } else if (q.q_type === "TrueFalse") {
    if (!["True", "False"].includes(q.correct_answer)) errors.push("Correct answer must be True or False.");
  } else if (q.q_type === "FillInTheBlank") {
    if (!q.correct_answer.trim()) errors.push("A non-empty correct answer is required.");
  }
  return errors;
}

export interface PublishCheckInput {
  evaluation_kind: EvaluationKind;
  activeQuestionCount: number;
  dirty: boolean;
}

/** Can this module be published right now? Drives the Publish button + tooltip. */
export function publishBlockReason(input: PublishCheckInput): string | null {
  if (input.dirty) return "Save your changes before publishing.";
  if (input.evaluation_kind === "quiz" && input.activeQuestionCount === 0) {
    return "A quiz module needs at least one active question before it can be published.";
  }
  return null;
}
