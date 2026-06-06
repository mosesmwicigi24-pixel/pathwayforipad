// Level exam (spec §1.9 rule 2, §3.3). The final module of a level unlocks the
// level exam; passing at/above levels.required_exam_pass_mark is necessary (but
// not sufficient — the reflection gate still applies) to advance. Scored
// server-side over the level's whole active question pool (unanswered = wrong),
// so a client cannot inflate its score. Idempotent on client_mutation_id.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, modulePassedPredicate, type EnrollmentRef } from "../progress/gating.js";

const normalize = (s: string): string => s.trim().toLowerCase();

export interface ExamResult {
  exam_attempt_id: string;
  score_achieved: number;
  is_passed: boolean;
  pass_mark: number;
  duplicate: boolean;
}

export class ExamService {
  constructor(private readonly pool: Pool) {}

  static readonly ExamSubmission = z.object({
    client_mutation_id: z.string().uuid(),
    answers: z.array(z.object({ question_id: z.string().uuid(), given_answer: z.string() })).min(1),
  });

  /** Level must be the member's current one with every module finished (§1.9). */
  private async requireLevelReady(
    c: Queryable,
    userId: string,
    levelNumber: number,
  ): Promise<EnrollmentRef> {
    const enrollment = await loadEnrollment(c, userId);
    if (!enrollment) throw new ApiError("UNPROCESSABLE", "No active enrollment");
    if (levelNumber > enrollment.current_level) {
      throw new ApiError("GATE_LOCKED", "Level is locked", { current_level: enrollment.current_level });
    }
    const pending = await one<{ n: number }>(
      c,
      `SELECT count(*)::int AS n
         FROM modules m
        WHERE m.level_number = $1 AND m.is_published
          AND NOT EXISTS (
            SELECT 1 FROM module_progress mp
              JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
             WHERE e.user_id = $2 AND mp.module_id = m.module_id AND mp.is_completed
               AND ${modulePassedPredicate("m", "mp")}
          )`,
      [levelNumber, userId],
    );
    if (pending.n > 0) {
      throw new ApiError("GATE_LOCKED", "Finish every module in this level before the exam", {
        modules_remaining: pending.n,
      });
    }
    return enrollment;
  }

  private examQuestions(c: Queryable, levelNumber: number, withAnswers: boolean): Promise<Array<Record<string, unknown>>> {
    const cols = withAnswers
      ? "q.question_id, q.correct_answer"
      : "q.question_id, q.q_type, q.question_text, q.answer_options";
    return many(
      c,
      `SELECT ${cols}
         FROM question_bank q JOIN modules m ON m.module_id = q.module_id
        WHERE m.level_number = $1 AND m.is_published AND q.is_active
        ${withAnswers ? "" : "ORDER BY random()"}`,
      [levelNumber],
    );
  }

  /** Assemble the exam from the level's active question pool (no answers leaked). */
  async assemble(userId: string, levelNumber: number): Promise<unknown> {
    await this.requireLevelReady(this.pool, userId, levelNumber);
    const questions = await this.examQuestions(this.pool, levelNumber, false);
    if (questions.length === 0) throw new ApiError("UNPROCESSABLE", "No exam questions for this level");
    return { level_number: levelNumber, question_count: questions.length, questions };
  }

  /** Score the exam server-side against required_exam_pass_mark. */
  async submit(
    userId: string,
    levelNumber: number,
    sub: z.infer<typeof ExamService.ExamSubmission>,
  ): Promise<ExamResult> {
    return tx(this.pool, async (c) => {
      const passMark = Number(
        (
          await one<{ required_exam_pass_mark: string }>(
            c,
            `SELECT required_exam_pass_mark FROM levels WHERE level_number = $1`,
            [levelNumber],
          )
        ).required_exam_pass_mark,
      );

      const dup = await maybeOne<{ exam_attempt_id: string; score_achieved: string; is_passed: boolean }>(
        c,
        `SELECT exam_attempt_id, score_achieved, is_passed FROM level_exam_attempts WHERE client_mutation_id = $1`,
        [sub.client_mutation_id],
      );
      if (dup) {
        return {
          exam_attempt_id: dup.exam_attempt_id,
          score_achieved: Number(dup.score_achieved),
          is_passed: dup.is_passed,
          pass_mark: passMark,
          duplicate: true,
        };
      }

      const enrollment = await this.requireLevelReady(c, userId, levelNumber);
      const active = (await this.examQuestions(c, levelNumber, true)) as Array<{
        question_id: string;
        correct_answer: string;
      }>;
      if (active.length === 0) throw new ApiError("UNPROCESSABLE", "No exam questions for this level");

      const submitted = new Map(sub.answers.map((a) => [a.question_id, a.given_answer]));
      let correct = 0;
      for (const q of active) {
        const given = submitted.get(q.question_id) ?? "";
        if (normalize(given) !== "" && normalize(given) === normalize(q.correct_answer)) correct += 1;
      }
      const score = Math.round((correct / active.length) * 10000) / 100;
      const isPassed = score >= passMark;

      const attempt = await one<{ exam_attempt_id: string }>(
        c,
        `INSERT INTO level_exam_attempts (enrollment_id, level_number, score_achieved, is_passed, question_set, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING exam_attempt_id`,
        [enrollment.enrollment_id, levelNumber, score, isPassed, JSON.stringify(active.map((q) => q.question_id)), sub.client_mutation_id],
      );
      await recordChange(c, "level_exam_attempts", attempt.exam_attempt_id, userId, "upsert");
      await audit(c, userId, "exam.attempted", "levels", String(levelNumber), { score, is_passed: isPassed });

      return {
        exam_attempt_id: attempt.exam_attempt_id,
        score_achieved: score,
        is_passed: isPassed,
        pass_mark: passMark,
        duplicate: false,
      };
    });
  }
}
