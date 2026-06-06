// Curriculum service (spec §1.5, §3.3). Levels, modules, lesson content, and the
// admin editing path that versions content. Reads are gated: locked module bodies
// are never returned (hard-lock invariant, §1.9).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, loadModule, isModuleUnlocked } from "../progress/gating.js";

export class CurriculumService {
  constructor(private readonly pool: Pool) {}

  listLevels(): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT level_number, title, theme, required_exam_pass_mark FROM levels ORDER BY level_number`,
    );
  }

  /** Modules for a level. Locked modules return metadata + locked:true, no body. */
  async listModulesForLevel(userId: string, levelNumber: number): Promise<unknown[]> {
    const enrollment = await loadEnrollment(this.pool, userId);
    const modules = await many<{
      module_id: string;
      level_number: number;
      module_sequence_number: number;
      title: string;
      estimated_minutes: number | null;
      quiz_pass_mark: string;
      is_published: boolean;
    }>(
      this.pool,
      `SELECT module_id, level_number, module_sequence_number, title, estimated_minutes,
              quiz_pass_mark, is_published
         FROM modules WHERE level_number = $1 AND is_published = TRUE
         ORDER BY module_sequence_number`,
      [levelNumber],
    );

    const out: unknown[] = [];
    for (const m of modules) {
      const unlocked =
        enrollment !== null &&
        (await isModuleUnlocked(this.pool, enrollment, {
          module_id: m.module_id,
          level_number: m.level_number,
          module_sequence_number: m.module_sequence_number,
        }));
      out.push({
        module_id: m.module_id,
        level_number: m.level_number,
        module_sequence_number: m.module_sequence_number,
        title: m.title,
        estimated_minutes: m.estimated_minutes,
        quiz_pass_mark: Number(m.quiz_pass_mark),
        locked: !unlocked,
      });
    }
    return out;
  }

  /** Full lesson content + (signed) media URL. 409 GATE_LOCKED if not unlocked. */
  async getModule(userId: string, moduleId: string): Promise<unknown> {
    const module = await loadModule(this.pool, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    const enrollment = await loadEnrollment(this.pool, userId);
    if (!enrollment || !(await isModuleUnlocked(this.pool, enrollment, module))) {
      throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
        module_sequence_number: module.module_sequence_number,
      });
    }
    const full = await one<{ video_url: string | null }>(
      this.pool,
      `SELECT module_id, level_number, module_sequence_number, title, lesson_content,
              video_url, evaluation_kind, estimated_minutes, quiz_pass_mark, current_version
         FROM modules WHERE module_id = $1`,
      [moduleId],
    );
    // Media is brokered as a signed URL by the media module; the raw video_url is
    // a placeholder reference here (§4.5). Wired when the media module lands.
    return { ...full, locked: false };
  }

  static readonly EditModuleSchema = z
    .object({
      lesson_content: z.string().min(1).optional(),
      quiz_pass_mark: z.number().min(0).max(100).optional(),
      title: z.string().min(1).max(255).optional(),
      is_published: z.boolean().optional(),
    })
    .strict();

  /** Admin edit: writes an immutable module_versions row, bumps current_version. */
  async editModule(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof CurriculumService.EditModuleSchema>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<{ current_version: number; lesson_content: string }>(
        c,
        `SELECT current_version, lesson_content FROM modules WHERE module_id = $1`,
        [moduleId],
      );
      if (!existing) throw new ApiError("NOT_FOUND", "Module not found");

      if (input.lesson_content !== undefined) {
        const nextVersion = existing.current_version + 1;
        await c.query(
          `INSERT INTO module_versions (module_id, version_number, lesson_content, edited_by)
           VALUES ($1,$2,$3,$4)`,
          [moduleId, nextVersion, input.lesson_content, editorId],
        );
        await c.query(
          `UPDATE modules SET lesson_content = $1, current_version = $2 WHERE module_id = $3`,
          [input.lesson_content, nextVersion, moduleId],
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (input.quiz_pass_mark !== undefined) {
        sets.push(`quiz_pass_mark = $${i++}`);
        params.push(input.quiz_pass_mark);
      }
      if (input.title !== undefined) {
        sets.push(`title = $${i++}`);
        params.push(input.title);
      }
      if (input.is_published !== undefined) {
        sets.push(`is_published = $${i++}`);
        params.push(input.is_published);
      }
      if (sets.length > 0) {
        params.push(moduleId);
        await c.query(`UPDATE modules SET ${sets.join(", ")} WHERE module_id = $${i}`, params);
      }

      await recordChange(c, "modules", moduleId, null, "upsert");
      await audit(c, editorId, "module.edited", "modules", moduleId, {});
      const updated = await one(c, `SELECT * FROM modules WHERE module_id = $1`, [moduleId]);
      return updated;
    });
  }

  static readonly AddQuestionsSchema = z.object({
    questions: z
      .array(
        z.object({
          q_type: z.enum(["MultipleChoice", "TrueFalse", "FillInTheBlank"]),
          question_text: z.string().min(1),
          answer_options: z.array(z.string()).optional(),
          correct_answer: z.string().min(1),
          difficulty_rating: z.number().int().min(1).max(5).default(1),
        }),
      )
      .min(1),
  });

  async addQuestions(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof CurriculumService.AddQuestionsSchema>,
  ): Promise<{ added: number }> {
    return tx(this.pool, async (c) => {
      const module = await maybeOne(c, `SELECT module_id FROM modules WHERE module_id = $1`, [moduleId]);
      if (!module) throw new ApiError("NOT_FOUND", "Module not found");
      for (const q of input.questions) {
        await c.query(
          `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            moduleId,
            q.q_type,
            q.question_text,
            q.answer_options ? JSON.stringify(q.answer_options) : null,
            q.correct_answer,
            q.difficulty_rating,
          ],
        );
      }
      await audit(c, editorId, "module.questions_added", "modules", moduleId, {
        count: input.questions.length,
      });
      return { added: input.questions.length };
    });
  }
}
