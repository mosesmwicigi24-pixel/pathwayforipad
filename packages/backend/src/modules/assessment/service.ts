// Assessment service (spec §1.9, §3.3, §3.7). Server-authoritative quiz
// assembly + scoring — the client never sees correct answers (§5.8) and never
// computes its own pass/fail (§1.3 server-authoritative truth).
//
// Quiz model: a module's quiz is its active question bank, served in randomized
// order. Scoring is over the full active set (an unanswered question counts as
// wrong), so a client cannot inflate its score by omitting hard questions.
// Pass/fail is `score >= modules.quiz_pass_mark`. A passing attempt is what the
// gating engine (§1.9) reads to unlock the next module.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, loadModule, isModuleUnlocked, type EnrollmentRef } from "../progress/gating.js";

const normalize = (s: string): string => s.trim().toLowerCase();

export interface QuizResult {
  attempt_id: string;
  score_achieved: number;
  is_passed: boolean;
  pass_mark: number;
  unlocked_next_module_id: string | null;
  duplicate: boolean;
}

export class AssessmentService {
  constructor(private readonly pool: Pool) {}

  static readonly QuizSubmission = z.object({
    client_mutation_id: z.string().uuid(),
    answers: z
      .array(z.object({ question_id: z.string().uuid(), given_answer: z.string() }))
      .min(1),
  });

  /** The module must exist and be unlocked for this user, else GATE_LOCKED/404. */
  private async requireUnlocked(
    c: Queryable,
    userId: string,
    moduleId: string,
  ): Promise<{ enrollment: EnrollmentRef; moduleSeq: number }> {
    const module = await loadModule(c, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    const enrollment = await loadEnrollment(c, userId);
    if (!enrollment || !(await isModuleUnlocked(c, enrollment, module))) {
      throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
        module_sequence_number: module.module_sequence_number,
      });
    }
    return { enrollment, moduleSeq: module.module_sequence_number };
  }

  /** Assemble a randomized quiz (no correct answers leaked, §5.8). */
  async assembleQuiz(userId: string, moduleId: string): Promise<unknown> {
    await this.requireUnlocked(this.pool, userId, moduleId);
    const questions = await many(
      this.pool,
      `SELECT question_id, q_type, question_text, answer_options
         FROM question_bank WHERE module_id = $1 AND is_active ORDER BY random()`,
      [moduleId],
    );
    if (questions.length === 0) throw new ApiError("UNPROCESSABLE", "Module has no quiz questions");
    return { module_id: moduleId, question_count: questions.length, questions };
  }

  /** Score a submission server-side and record the attempt. */
  async submitQuiz(
    userId: string,
    moduleId: string,
    sub: z.infer<typeof AssessmentService.QuizSubmission>,
  ): Promise<QuizResult> {
    return tx(this.pool, async (c) => {
      // Offline idempotency: a replayed attempt returns the original result.
      const dup = await maybeOne<{ attempt_id: string; score_achieved: string; is_passed: boolean }>(
        c,
        `SELECT attempt_id, score_achieved, is_passed FROM quiz_attempts WHERE client_mutation_id = $1`,
        [sub.client_mutation_id],
      );

      const { enrollment } = await this.requireUnlocked(c, userId, moduleId);
      const passMark = Number(
        (
          await one<{ quiz_pass_mark: string }>(
            c,
            `SELECT quiz_pass_mark FROM modules WHERE module_id = $1`,
            [moduleId],
          )
        ).quiz_pass_mark,
      );

      if (dup) {
        return {
          attempt_id: dup.attempt_id,
          score_achieved: Number(dup.score_achieved),
          is_passed: dup.is_passed,
          pass_mark: passMark,
          unlocked_next_module_id: dup.is_passed
            ? await this.nextUnlockedId(c, enrollment, moduleId)
            : null,
          duplicate: true,
        };
      }

      // Ensure a progress row exists to anchor the attempt (FK quiz_attempts → module_progress).
      const prog = await one<{ progress_id: string }>(
        c,
        `INSERT INTO module_progress (enrollment_id, module_id) VALUES ($1, $2)
         ON CONFLICT (enrollment_id, module_id) DO UPDATE SET row_version = module_progress.row_version
         RETURNING progress_id`,
        [enrollment.enrollment_id, moduleId],
      );

      const active = await many<{ question_id: string; correct_answer: string }>(
        c,
        `SELECT question_id, correct_answer FROM question_bank WHERE module_id = $1 AND is_active`,
        [moduleId],
      );
      if (active.length === 0) throw new ApiError("UNPROCESSABLE", "Module has no quiz questions");

      const submitted = new Map(sub.answers.map((a) => [a.question_id, a.given_answer]));
      let correct = 0;
      const graded = active.map((q) => {
        const given = submitted.get(q.question_id) ?? "";
        const isCorrect = normalize(given) !== "" && normalize(given) === normalize(q.correct_answer);
        if (isCorrect) correct += 1;
        return { question_id: q.question_id, given_answer: given, is_correct: isCorrect };
      });
      const score = Math.round((correct / active.length) * 10000) / 100; // 2 dp
      const isPassed = score >= passMark;

      const attempt = await one<{ attempt_id: string }>(
        c,
        `INSERT INTO quiz_attempts (progress_id, score_achieved, is_passed, question_set, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING attempt_id`,
        [prog.progress_id, score, isPassed, JSON.stringify(active.map((q) => q.question_id)), sub.client_mutation_id],
      );
      for (const g of graded) {
        await c.query(
          `INSERT INTO quiz_attempt_answers (attempt_id, question_id, given_answer, is_correct)
           VALUES ($1, $2, $3, $4)`,
          [attempt.attempt_id, g.question_id, g.given_answer, g.is_correct],
        );
      }

      await recordChange(c, "quiz_attempts", attempt.attempt_id, userId, "upsert");
      await audit(c, userId, "quiz.attempted", "modules", moduleId, { score, is_passed: isPassed });

      return {
        attempt_id: attempt.attempt_id,
        score_achieved: score,
        is_passed: isPassed,
        pass_mark: passMark,
        unlocked_next_module_id: isPassed ? await this.nextUnlockedId(c, enrollment, moduleId) : null,
        duplicate: false,
      };
    });
  }

  /** The next module in the same level, if the gating engine now unlocks it. */
  private async nextUnlockedId(
    c: Pool | PoolClient,
    enrollment: EnrollmentRef,
    moduleId: string,
  ): Promise<string | null> {
    const next = await maybeOne<{ module_id: string; level_number: number; module_sequence_number: number }>(
      c,
      `SELECT n.module_id, n.level_number, n.module_sequence_number
         FROM modules cur
         JOIN modules n ON n.level_number = cur.level_number
          AND n.module_sequence_number = cur.module_sequence_number + 1
        WHERE cur.module_id = $1`,
      [moduleId],
    );
    if (!next) return null;
    return (await isModuleUnlocked(c, enrollment, next)) ? next.module_id : null;
  }
}
