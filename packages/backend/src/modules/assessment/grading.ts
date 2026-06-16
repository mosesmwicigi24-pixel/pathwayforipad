// Server-authoritative per-type auto-scoring for quizzes and level exams
// (§1.3, §1.9, §5.8). Shared by the module-quiz path (service.ts) and the
// level-exam path (exam.ts) so both grade identically.
//
// Scoring is POINTS-WEIGHTED: score = earned_points / gradable_points * 100,
// rounded to 2 dp. Every legacy question carries points=1, so this reduces to
// the historical correct/total percentage for existing data (backward compatible).
//
// Per-type rules (all-or-nothing — documented policy, no partial credit):
//   • single-select (multiple_choice | dropdown | legacy MultipleChoice/TrueFalse/
//     FillInTheBlank): exact case-insensitive match of the one correct answer.
//   • checkbox (multi-correct): the submitted SET must equal the correct SET
//     exactly (all correct, no extras) for full points; else zero.
//   • short_answer: if a correct key exists → case-insensitive trim match; if the
//     key is empty ('') the item is MANUAL (excluded from auto pass/fail).
//   • paragraph: always MANUAL (never auto-graded; excluded from auto pass/fail).
//   • linear_scale: collected, not keyed — award its points iff answered.
//
// MANUAL items (paragraph, keyless short_answer) are excluded from the gradable
// denominator so they never silently block §1.9 level advancement. They are
// recorded (is_correct=false, is_manual=true) for human review. If a quiz/exam
// has ZERO gradable items, score is 0 and is_passed is false (it cannot be
// auto-passed) while requires_manual_review surfaces the need for review.

const normalize = (s: string): string => s.trim().toLowerCase();

/**
 * Strip correct-answer signal from a question's answer_options before serving it
 * to a learner (§5.8). Legacy string-array options carry no signal and pass
 * through unchanged; structured options have their choices[].is_correct removed.
 */
export function stripAnswerSignal(answerOptions: unknown): unknown {
  if (answerOptions === null || answerOptions === undefined) return answerOptions;
  if (Array.isArray(answerOptions)) return answerOptions; // legacy string[] — no signal
  if (typeof answerOptions === "object") {
    const o = answerOptions as { choices?: Array<{ id?: unknown; text?: unknown }>; scale?: unknown };
    const out: Record<string, unknown> = {};
    if (Array.isArray(o.choices)) {
      out.choices = o.choices.map((c) => ({ id: c.id, text: c.text })); // drop is_correct
    }
    if (o.scale !== undefined) out.scale = o.scale;
    return out;
  }
  return answerOptions;
}

export interface GradableQuestion {
  question_id: string;
  q_type: string;
  correct_answer: string; // scalar, JSON array (checkbox), or '' (manual/scale)
  points: number;
}

export interface GradedAnswer {
  question_id: string;
  given_answer: string;
  is_correct: boolean;
  is_manual: boolean;
}

export interface GradeOutcome {
  score: number; // 0..100, 2 dp
  earned_points: number;
  gradable_points: number;
  graded: GradedAnswer[];
  requires_manual_review: boolean;
}

/** True for question types that are never auto-graded. */
function isParagraph(qType: string): boolean {
  return qType === "paragraph";
}

/** Parse the checkbox correct-set from correct_answer (a JSON array of strings). */
function parseCorrectSet(correctAnswer: string): string[] {
  try {
    const v = JSON.parse(correctAnswer);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** Parse a submitted checkbox answer (JSON array) or fall back to a single value. */
function parseGivenSet(given: string): string[] {
  const t = given.trim();
  if (t === "") return [];
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v.map((x) => String(x));
  } catch {
    // not JSON — treat as a single chosen value
  }
  return [t];
}

function setsEqualCI(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (xs: string[]): Set<string> => new Set(xs.map(normalize));
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Grade a submission against the active question set. `answers` maps
 * question_id → given_answer (unanswered = wrong, by §5.8 anti-gaming rule).
 */
export function gradeSubmission(
  questions: GradableQuestion[],
  answers: Map<string, string>,
): GradeOutcome {
  let earned = 0;
  let gradable = 0;
  let manualSeen = false;
  const graded: GradedAnswer[] = [];

  for (const q of questions) {
    const given = answers.get(q.question_id) ?? "";
    const pts = q.points > 0 ? q.points : 1;

    // ---- MANUAL items: excluded from auto pass/fail. --------------------
    const keyless = q.q_type === "short_answer" && q.correct_answer.trim() === "";
    if (isParagraph(q.q_type) || keyless) {
      manualSeen = true;
      graded.push({ question_id: q.question_id, given_answer: given, is_correct: false, is_manual: true });
      continue;
    }

    gradable += pts;
    let isCorrect = false;

    if (q.q_type === "checkbox") {
      const correctSet = parseCorrectSet(q.correct_answer);
      const givenSet = parseGivenSet(given);
      isCorrect = givenSet.length > 0 && setsEqualCI(givenSet, correctSet);
    } else if (q.q_type === "linear_scale") {
      // Collected, not keyed: award points iff the learner answered.
      isCorrect = given.trim() !== "";
    } else {
      // single-select / short_answer (keyed) / legacy: exact CI match.
      isCorrect = normalize(given) !== "" && normalize(given) === normalize(q.correct_answer);
    }

    if (isCorrect) earned += pts;
    graded.push({ question_id: q.question_id, given_answer: given, is_correct: isCorrect, is_manual: false });
  }

  const score = gradable > 0 ? Math.round((earned / gradable) * 10000) / 100 : 0;
  return {
    score,
    earned_points: earned,
    gradable_points: gradable,
    graded,
    requires_manual_review: manualSeen,
  };
}
