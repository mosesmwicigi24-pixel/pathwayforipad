// Curriculum service (spec §1.5, §3.3). Levels, modules, lesson content, and the
// admin editing path that versions content. Reads are gated: locked module bodies
// are never returned (hard-lock invariant, §1.9).
import type { Pool } from "pg";
import type Redis from "ioredis";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { cacheGetSet, cacheKeys } from "../../cache.js";
import { loadEnrollment, loadModule, isModuleUnlocked, isEntryModule } from "../progress/gating.js";

export class CurriculumService {
  constructor(
    private readonly pool: Pool,
    private readonly redis?: Redis,
  ) {}

  /** Level catalog — identical for everyone, so cached (busted on admin edits). */
  listLevels(): Promise<unknown[]> {
    return cacheGetSet(this.redis, cacheKeys.levels, 600, () =>
      many(
        this.pool,
        `SELECT level_number, title, theme, required_exam_pass_mark FROM levels ORDER BY level_number`,
      ),
    );
  }

  /**
   * Per-level pathway summary for the member: every level with its published
   * module count, how many this member has completed, and a derived status
   * (completed / active / locked) respecting the hard-lock ceiling (§1.9).
   * Powers the Home dashboard and Levels overview in one round-trip.
   */
  async getPathwaySummary(userId: string): Promise<unknown> {
    const enrollment = await loadEnrollment(this.pool, userId);
    const currentLevel = enrollment?.current_level ?? 1;
    const rows = await many<{
      level_number: number;
      title: string;
      theme: string | null;
      total_modules: number;
      completed_modules: number;
      minutes: number;
    }>(
      this.pool,
      // A module counts as done if the member completed it OR it sits before the
      // admin-set entry point in their placed level (covered by placement, §1.9
      // entry-point). Defaults (start_level 1, seq 1) make the covered clause inert.
      `SELECT l.level_number, l.title, l.theme,
              COUNT(m.module_id)::int AS total_modules,
              COUNT(*) FILTER (
                WHERE m.module_id IS NOT NULL
                  AND (mp.progress_id IS NOT NULL
                       OR (l.level_number = $2 AND m.module_sequence_number < $3))
              )::int AS completed_modules,
              COALESCE(SUM(m.estimated_minutes), 0)::int AS minutes
         FROM levels l
         LEFT JOIN modules m
           ON m.level_number = l.level_number AND m.is_published = TRUE
         LEFT JOIN module_progress mp
           ON mp.module_id = m.module_id AND mp.is_completed
          AND mp.enrollment_id = $1
        GROUP BY l.level_number, l.title, l.theme
        ORDER BY l.level_number`,
      [enrollment?.enrollment_id ?? null, enrollment?.start_level ?? 1, enrollment?.start_module_sequence ?? 1],
    );

    const levels = rows.map((r) => {
      const allDone = r.total_modules > 0 && r.completed_modules >= r.total_modules;
      const status =
        r.level_number < currentLevel
          ? "completed"
          : r.level_number > currentLevel
            ? "locked"
            : allDone
              ? "completed"
              : "active";
      return {
        level_number: r.level_number,
        title: r.title,
        theme: r.theme,
        total_modules: r.total_modules,
        completed_modules: r.completed_modules,
        minutes: r.minutes,
        status,
      };
    });
    return { current_level: currentLevel, levels };
  }

  /** Modules for a level. Locked modules return metadata + locked:true, no body. */
  async listModulesForLevel(userId: string, levelNumber: number): Promise<unknown[]> {
    const enrollment = await loadEnrollment(this.pool, userId);
    const modules = await many<{
      module_id: string;
      level_number: number;
      module_sequence_number: number;
      title: string;
      summary: string | null;
      estimated_minutes: number | null;
      evaluation_kind: string;
      quiz_pass_mark: string;
      is_published: boolean;
    }>(
      this.pool,
      `SELECT module_id, level_number, module_sequence_number, title, summary, estimated_minutes,
              evaluation_kind, quiz_pass_mark, is_published
         FROM modules WHERE level_number = $1 AND is_published = TRUE
         ORDER BY module_sequence_number`,
      [levelNumber],
    );

    // One query for everything this member has completed; cheap set membership.
    const completedRows = enrollment
      ? await many<{ module_id: string }>(
          this.pool,
          `SELECT module_id FROM module_progress WHERE enrollment_id = $1 AND is_completed`,
          [enrollment.enrollment_id],
        )
      : [];
    const completedSet = new Set(completedRows.map((r) => r.module_id));

    const out: unknown[] = [];
    for (const m of modules) {
      const unlocked =
        isEntryModule(m.level_number, m.module_sequence_number) ||
        (enrollment !== null &&
          (await isModuleUnlocked(this.pool, enrollment, {
            module_id: m.module_id,
            level_number: m.level_number,
            module_sequence_number: m.module_sequence_number,
          })));
      // Modules before the admin-set entry point are "covered" by the placement —
      // shown as completed (the member begins at the entry module).
      const covered =
        enrollment !== null &&
        m.level_number === enrollment.start_level &&
        m.module_sequence_number < enrollment.start_module_sequence;
      const completed = completedSet.has(m.module_id) || covered;
      const status = completed ? "completed" : unlocked ? "next" : "locked";
      out.push({
        module_id: m.module_id,
        level_number: m.level_number,
        module_sequence_number: m.module_sequence_number,
        title: m.title,
        summary: m.summary,
        estimated_minutes: m.estimated_minutes,
        evaluation_kind: m.evaluation_kind,
        quiz_pass_mark: Number(m.quiz_pass_mark),
        completed,
        status,
        progress: completed ? 100 : 0,
        locked: !unlocked,
      });
    }
    return out;
  }

  /** Full lesson content + (signed) media URL. 409 GATE_LOCKED if not unlocked. */
  async getModule(userId: string, moduleId: string): Promise<unknown> {
    const module = await loadModule(this.pool, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    // Students never receive non-published bodies — drafts/archived are invisible
    // (the hard-lock invariant extends to lifecycle state, §1.9).
    const pub = await maybeOne<{ is_published: boolean }>(
      this.pool,
      `SELECT is_published FROM modules WHERE module_id = $1`,
      [moduleId],
    );
    if (!pub?.is_published) throw new ApiError("NOT_FOUND", "Module not found");
    // Level 1 · Module 1 is the universal entry point — always readable, even
    // before an enrollment exists. Everything else stays gated (§1.9).
    if (!isEntryModule(module.level_number, module.module_sequence_number)) {
      const enrollment = await loadEnrollment(this.pool, userId);
      if (!enrollment || !(await isModuleUnlocked(this.pool, enrollment, module))) {
        throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
          module_sequence_number: module.module_sequence_number,
        });
      }
    }
    // Published lesson bodies are identical for every reader, so the (heavy)
    // content read is cached and busted whenever an admin edits the module.
    const full = await cacheGetSet(this.redis, cacheKeys.moduleContent(moduleId), 600, () =>
      one<{ video_url: string | null }>(
        this.pool,
        `SELECT module_id, level_number, module_sequence_number, title, lesson_content,
                summary, key_verses, video_url, evaluation_kind, estimated_minutes,
                quiz_pass_mark, current_version
           FROM modules WHERE module_id = $1`,
        [moduleId],
      ),
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
        // is_published is a generated mirror of status now — write status instead.
        sets.push(`status = $${i++}`);
        params.push(input.is_published ? "published" : "draft");
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
