// Admin curriculum authoring service (Prompt 5 Phase B, §3.3, §5.4, §5.8).
// Admins/SuperAdmins build and maintain the entire pathway: levels, modules,
// rich-text lessons, quiz questions, drafts, publishing, reorder and version
// history. Every write is audited and recorded for client sync; every
// lesson-content change writes an immutable module_versions row. Server-
// authoritative throughout — the client never originates gating or status.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const KIND = z.enum(["none", "reflection", "quiz", "exit_exam"]);

// ---- Question validation (per-type, §5.8) ----------------------------------
const QuestionInput = z.object({
  q_type: z.enum(["MultipleChoice", "TrueFalse", "FillInTheBlank"]),
  question_text: z.string().min(1),
  answer_options: z.array(z.string()).optional(),
  correct_answer: z.string().min(1),
  difficulty_rating: z.number().int().min(1).max(5).default(1),
  explanation: z.string().nullable().optional(),
  points: z.number().int().min(1).max(100).default(1),
  /** Author can create a question as a draft (excluded from the live quiz). */
  is_active: z.boolean().optional(),
});
type QuestionInput = z.infer<typeof QuestionInput>;

function validateQuestion(q: QuestionInput): void {
  if (q.q_type === "MultipleChoice") {
    if (!q.answer_options || q.answer_options.length < 2) {
      throw new ApiError("VALIDATION_FAILED", "MultipleChoice needs at least 2 options");
    }
    if (!q.answer_options.includes(q.correct_answer)) {
      throw new ApiError("VALIDATION_FAILED", "correct_answer must be one of the options");
    }
  } else if (q.q_type === "TrueFalse") {
    if (!["True", "False"].includes(q.correct_answer)) {
      throw new ApiError("VALIDATION_FAILED", "TrueFalse correct_answer must be 'True' or 'False'");
    }
  } else if (q.q_type === "FillInTheBlank") {
    if (q.correct_answer.trim().length === 0) {
      throw new ApiError("VALIDATION_FAILED", "FillInTheBlank needs a non-empty correct_answer");
    }
  }
}

export class AdminCurriculumService {
  constructor(private readonly pool: Pool) {}

  // ===================== LEVELS =====================

  listLevels(): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT l.level_number, l.title, l.theme, l.required_exam_pass_mark, l.exam_question_count,
              l.duration, l.status, l.locked, l.color,
              COUNT(m.module_id) FILTER (WHERE m.status = 'published') AS published_count,
              COUNT(m.module_id) FILTER (WHERE m.status = 'draft')     AS draft_count,
              COUNT(m.module_id) FILTER (WHERE m.status = 'archived')  AS archived_count
         FROM levels l LEFT JOIN modules m ON m.level_number = l.level_number
        GROUP BY l.level_number
        ORDER BY l.level_number`,
    );
  }

  static readonly CreateLevel = z
    .object({
      title: z.string().min(1).max(255),
      theme: z.string().optional(),
      required_exam_pass_mark: z.number().min(0).max(100).optional(),
      duration: z.string().max(40).optional(),
      status: z.enum(["published", "draft", "in_review"]).optional(),
      locked: z.boolean().optional(),
      color: z.string().max(9).optional(),
    })
    .strict();

  /** Create the NEXT contiguous level (no gaps). */
  async createLevel(editorId: string, input: z.infer<typeof AdminCurriculumService.CreateLevel>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const max = await one<{ n: number }>(c, `SELECT COALESCE(MAX(level_number), 0)::int AS n FROM levels`);
      const next = max.n + 1;
      const row = await one(
        c,
        `INSERT INTO levels (level_number, title, theme, required_exam_pass_mark, duration, status, locked, color)
         VALUES ($1,$2,$3,COALESCE($4, 80.00),$5,COALESCE($6,'draft'),COALESCE($7,FALSE),COALESCE($8,'#0B84E8')) RETURNING *`,
        [next, input.title, input.theme ?? null, input.required_exam_pass_mark ?? null, input.duration ?? null, input.status ?? null, input.locked ?? null, input.color ?? null],
      );
      await audit(c, editorId, "level.created", "levels", String(next), { title: input.title });
      return row;
    });
  }

  static readonly UpdateLevel = z
    .object({
      title: z.string().min(1).max(255).optional(),
      theme: z.string().nullable().optional(),
      required_exam_pass_mark: z.number().min(0).max(100).optional(),
      duration: z.string().max(40).nullable().optional(),
      status: z.enum(["published", "draft", "in_review"]).optional(),
      locked: z.boolean().optional(),
      color: z.string().max(9).optional(),
    })
    .strict();

  async updateLevel(
    levelNumber: number,
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.UpdateLevel>,
  ): Promise<unknown> {
    return this.patchLevel(levelNumber, editorId, input, "level.updated");
  }

  static readonly UpdateExam = z
    .object({
      required_exam_pass_mark: z.number().min(0).max(100),
      exam_question_count: z.number().int().min(1).nullable().optional(),
    })
    .strict();

  /** Configure the level exit exam: pass mark + (optional) served question count. */
  async updateLevelExam(
    levelNumber: number,
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.UpdateExam>,
  ): Promise<unknown> {
    return this.patchLevel(
      levelNumber,
      editorId,
      {
        required_exam_pass_mark: input.required_exam_pass_mark,
        exam_question_count: input.exam_question_count ?? null,
      },
      "level.exam_configured",
    );
  }

  private async patchLevel(
    levelNumber: number,
    editorId: string,
    fields: Record<string, unknown>,
    action: string,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const exists = await maybeOne(c, `SELECT 1 FROM levels WHERE level_number = $1`, [levelNumber]);
      if (!exists) throw new ApiError("NOT_FOUND", "Level not found");
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (keys.length > 0) {
        const sets = keys.map((k, idx) => `${k} = $${idx + 2}`);
        await c.query(`UPDATE levels SET ${sets.join(", ")} WHERE level_number = $1`, [
          levelNumber,
          ...keys.map((k) => fields[k]),
        ]);
      }
      await audit(c, editorId, action, "levels", String(levelNumber), fields);
      return one(c, `SELECT * FROM levels WHERE level_number = $1`, [levelNumber]);
    });
  }

  // ===================== MODULES =====================

  /** All modules for a level incl. drafts/archived, in sequence (admin view). */
  listModulesForLevel(levelNumber: number): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT module_id, level_number, module_sequence_number, title, summary, status, is_published,
              evaluation_kind, quiz_pass_mark, estimated_minutes, video_url, current_version,
              row_version, updated_at,
              (SELECT COUNT(*) FROM question_bank q WHERE q.module_id = m.module_id AND q.is_active) AS active_question_count
         FROM modules m
        WHERE level_number = $1
        ORDER BY module_sequence_number`,
      [levelNumber],
    );
  }

  static readonly CreateModule = z
    .object({
      level_number: z.number().int().min(1),
      title: z.string().min(1).max(255),
      lesson_content: z.string().min(1),
      evaluation_kind: KIND.default("none"),
      quiz_pass_mark: z.number().min(0).max(100).optional(),
      estimated_minutes: z.number().int().min(0).nullable().optional(),
      video_url: z.string().url().max(512).nullable().optional(),
      summary: z.string().nullable().optional(),
      key_verses: z.array(z.string()).nullable().optional(),
      module_sequence_number: z.number().int().min(1).optional(),
      // Quiz Builder config (B4) — enforced server-side at assemble/submit.
      time_limit_sec: z.number().int().min(30).max(7200).nullable().optional(),
      max_attempts: z.number().int().min(1).max(50).nullable().optional(),
    })
    .strict();

  /** Create a module; sequence auto-appends unless supplied (must keep contiguity). */
  async createModule(
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.CreateModule>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const level = await maybeOne(c, `SELECT 1 FROM levels WHERE level_number = $1`, [input.level_number]);
      if (!level) throw new ApiError("UNPROCESSABLE", "Level does not exist");

      const max = await one<{ n: number }>(
        c,
        `SELECT COALESCE(MAX(module_sequence_number), 0)::int AS n FROM modules WHERE level_number = $1`,
        [input.level_number],
      );
      const seq = input.module_sequence_number ?? max.n + 1;
      if (seq > max.n + 1) {
        throw new ApiError("UNPROCESSABLE", "module_sequence_number would create a gap", {
          next_allowed: max.n + 1,
        });
      }

      let row;
      try {
        row = await one<{ module_id: string }>(
          c,
          `INSERT INTO modules
             (level_number, module_sequence_number, title, lesson_content, evaluation_kind,
              quiz_pass_mark, estimated_minutes, video_url, summary, key_verses, status, current_version,
              time_limit_sec, max_attempts)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,70.00),$7,$8,$9,$10,'draft',1,$11,$12)
           RETURNING module_id`,
          [
            input.level_number,
            seq,
            input.title,
            input.lesson_content,
            input.evaluation_kind,
            input.quiz_pass_mark ?? null,
            input.estimated_minutes ?? null,
            input.video_url ?? null,
            input.summary ?? null,
            input.key_verses ? JSON.stringify(input.key_verses) : null,
            input.time_limit_sec ?? null,
            input.max_attempts ?? null,
          ],
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ApiError("CONFLICT", "A module already occupies that sequence number");
        }
        throw e;
      }

      // Seed version 1 with the initial content so history starts at creation.
      await c.query(
        `INSERT INTO module_versions (module_id, version_number, lesson_content, edited_by)
         VALUES ($1,1,$2,$3)`,
        [row.module_id, input.lesson_content, editorId],
      );
      await recordChange(c, "modules", row.module_id, editorId, "upsert");
      await audit(c, editorId, "module.created", "modules", row.module_id, {
        level_number: input.level_number,
        sequence: seq,
      });
      return this.fetchModule(c, row.module_id);
    });
  }

  async getModule(moduleId: string): Promise<unknown> {
    const row = await this.fetchModule(this.pool, moduleId);
    if (!row) throw new ApiError("NOT_FOUND", "Module not found");
    return row;
  }

  private fetchModule(c: Queryable, moduleId: string): Promise<unknown> {
    return maybeOne(
      c,
      `SELECT module_id, level_number, module_sequence_number, title, summary, lesson_content,
              key_verses, status, is_published, evaluation_kind, quiz_pass_mark, estimated_minutes,
              video_url, media_asset_id, time_limit_sec, max_attempts, quiz_shuffle,
              difficulty, objectives, tags, visibility, required,
              current_version, row_version, created_at, updated_at
         FROM modules WHERE module_id = $1`,
      [moduleId],
    );
  }

  static readonly UpdateModule = z
    .object({
      title: z.string().min(1).max(255).optional(),
      summary: z.string().nullable().optional(),
      lesson_content: z.string().min(1).optional(),
      evaluation_kind: KIND.optional(),
      quiz_pass_mark: z.number().min(0).max(100).optional(),
      estimated_minutes: z.number().int().min(0).nullable().optional(),
      video_url: z.string().url().max(512).nullable().optional(),
      media_asset_id: z.string().uuid().nullable().optional(), // managed Video Library asset (W2)
      key_verses: z.array(z.string()).nullable().optional(),
      time_limit_sec: z.number().int().min(30).max(7200).nullable().optional(),
      max_attempts: z.number().int().min(1).max(50).nullable().optional(),
      quiz_shuffle: z.boolean().optional(),
      /** Editorial metadata (Level Detail editor) — presentation only. */
      difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      objectives: z.string().nullable().optional(),
      tags: z.string().nullable().optional(),
      visibility: z.enum(["members", "leaders", "public"]).optional(),
      required: z.boolean().optional(),
      /** Optimistic-concurrency guard (§5.8): reject if the row changed since load. */
      expected_row_version: z.number().int().min(1).optional(),
    })
    .strict();

  /** Edit any field; a content change versions the module. Optimistic-concurrency aware. */
  async updateModule(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.UpdateModule>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<{ current_version: number; row_version: number }>(
        c,
        `SELECT current_version, row_version FROM modules WHERE module_id = $1 FOR UPDATE`,
        [moduleId],
      );
      if (!existing) throw new ApiError("NOT_FOUND", "Module not found");
      if (input.expected_row_version !== undefined && input.expected_row_version !== existing.row_version) {
        throw new ApiError("VERSION_STALE", "Module changed since you loaded it", {
          expected: input.expected_row_version,
          actual: existing.row_version,
        });
      }

      if (input.lesson_content !== undefined) {
        const nextVersion = existing.current_version + 1;
        await c.query(
          `INSERT INTO module_versions (module_id, version_number, lesson_content, edited_by)
           VALUES ($1,$2,$3,$4)`,
          [moduleId, nextVersion, input.lesson_content, editorId],
        );
        await c.query(`UPDATE modules SET lesson_content = $1, current_version = $2 WHERE module_id = $3`, [
          input.lesson_content,
          nextVersion,
          moduleId,
        ]);
      }

      const cols: Record<string, unknown> = {
        title: input.title,
        summary: input.summary,
        evaluation_kind: input.evaluation_kind,
        quiz_pass_mark: input.quiz_pass_mark,
        estimated_minutes: input.estimated_minutes,
        video_url: input.video_url,
        media_asset_id: input.media_asset_id,
        time_limit_sec: input.time_limit_sec,
        max_attempts: input.max_attempts,
        quiz_shuffle: input.quiz_shuffle,
        difficulty: input.difficulty,
        objectives: input.objectives,
        tags: input.tags,
        visibility: input.visibility,
        required: input.required,
        key_verses: input.key_verses === undefined ? undefined : input.key_verses === null ? null : JSON.stringify(input.key_verses),
      };
      const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
      if (keys.length > 0) {
        const sets = keys.map((k, idx) => `${k} = $${idx + 2}`);
        await c.query(`UPDATE modules SET ${sets.join(", ")} WHERE module_id = $1`, [
          moduleId,
          ...keys.map((k) => cols[k]),
        ]);
      }

      await recordChange(c, "modules", moduleId, editorId, "upsert");
      await audit(c, editorId, "module.updated", "modules", moduleId, { fields: keys });
      return this.fetchModule(c, moduleId);
    });
  }

  /** Publish, with validation (§1.9 Phase C rule 12). */
  async publish(moduleId: string, editorId: string): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const m = await maybeOne<{
        level_number: number;
        module_sequence_number: number;
        evaluation_kind: string;
        status: string;
      }>(
        c,
        `SELECT level_number, module_sequence_number, evaluation_kind, status
           FROM modules WHERE module_id = $1 FOR UPDATE`,
        [moduleId],
      );
      if (!m) throw new ApiError("NOT_FOUND", "Module not found");

      if (m.evaluation_kind === "quiz") {
        const q = await one<{ n: number }>(
          c,
          `SELECT COUNT(*)::int AS n FROM question_bank WHERE module_id = $1 AND is_active`,
          [moduleId],
        );
        if (q.n === 0) {
          throw new ApiError("UNPROCESSABLE", "Cannot publish a quiz module with no active questions");
        }
      }

      // Published sequence must stay contiguous from 1: every lower-sequence
      // module in the level must already be published.
      const gap = await one<{ n: number }>(
        c,
        `SELECT COUNT(*)::int AS n FROM modules
          WHERE level_number = $1 AND module_sequence_number < $2 AND status <> 'published'`,
        [m.level_number, m.module_sequence_number],
      );
      if (gap.n > 0) {
        throw new ApiError("UNPROCESSABLE", "Publish earlier modules first to keep the sequence contiguous", {
          unpublished_before: gap.n,
        });
      }

      await c.query(`UPDATE modules SET status = 'published' WHERE module_id = $1`, [moduleId]);
      await recordChange(c, "modules", moduleId, editorId, "upsert");
      await audit(c, editorId, "module.published", "modules", moduleId, {});
      return this.fetchModule(c, moduleId);
    });
  }

  async unpublish(moduleId: string, editorId: string): Promise<unknown> {
    return this.setStatus(moduleId, editorId, "draft", "module.unpublished");
  }

  /** DELETE = soft archive; learner progress/attempts are never orphaned. */
  async archive(moduleId: string, editorId: string): Promise<unknown> {
    return this.setStatus(moduleId, editorId, "archived", "module.archived");
  }

  private async setStatus(
    moduleId: string,
    editorId: string,
    status: "draft" | "published" | "archived",
    action: string,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const m = await maybeOne(c, `SELECT 1 FROM modules WHERE module_id = $1`, [moduleId]);
      if (!m) throw new ApiError("NOT_FOUND", "Module not found");
      await c.query(`UPDATE modules SET status = $2 WHERE module_id = $1`, [moduleId, status]);
      await recordChange(c, "modules", moduleId, editorId, "upsert");
      await audit(c, editorId, action, "modules", moduleId, {});
      return this.fetchModule(c, moduleId);
    });
  }

  static readonly Reorder = z.object({ to_sequence: z.number().int().min(1) }).strict();

  /** Move a module within its level; re-sequence atomically, preserving contiguity. */
  async reorder(moduleId: string, editorId: string, toSequence: number): Promise<unknown[]> {
    return tx(this.pool, async (c) => {
      const target = await maybeOne<{ level_number: number; module_sequence_number: number }>(
        c,
        `SELECT level_number, module_sequence_number FROM modules WHERE module_id = $1`,
        [moduleId],
      );
      if (!target) throw new ApiError("NOT_FOUND", "Module not found");

      const ordered = await many<{ module_id: string }>(
        c,
        `SELECT module_id FROM modules WHERE level_number = $1 ORDER BY module_sequence_number`,
        [target.level_number],
      );
      const ids = ordered.map((r) => r.module_id);
      const from = ids.indexOf(moduleId);
      const to = Math.min(Math.max(toSequence, 1), ids.length) - 1;
      if (from !== to) {
        ids.splice(to, 0, ids.splice(from, 1)[0]!);
        // Two-pass to dodge the UNIQUE(level,sequence) clash: park at negatives, then assign.
        for (let i = 0; i < ids.length; i++) {
          await c.query(`UPDATE modules SET module_sequence_number = $2 WHERE module_id = $1`, [ids[i], -(i + 1)]);
        }
        for (let i = 0; i < ids.length; i++) {
          await c.query(`UPDATE modules SET module_sequence_number = $2 WHERE module_id = $1`, [ids[i], i + 1]);
        }
      }
      await recordChange(c, "modules", moduleId, editorId, "upsert");
      await audit(c, editorId, "module.reordered", "modules", moduleId, { to_sequence: to + 1 });
      return many(
        c,
        `SELECT module_id, module_sequence_number, title, status FROM modules
          WHERE level_number = $1 ORDER BY module_sequence_number`,
        [target.level_number],
      );
    });
  }

  // ===================== VERSIONS =====================

  async listVersions(moduleId: string): Promise<unknown[]> {
    const m = await maybeOne(this.pool, `SELECT 1 FROM modules WHERE module_id = $1`, [moduleId]);
    if (!m) throw new ApiError("NOT_FOUND", "Module not found");
    return many(
      this.pool,
      `SELECT v.version_id, v.version_number, v.edited_by, u.full_name AS edited_by_name, v.created_at
         FROM module_versions v LEFT JOIN users u ON u.user_id = v.edited_by
        WHERE v.module_id = $1 ORDER BY v.version_number DESC`,
      [moduleId],
    );
  }

  static readonly Revert = z.object({ version_number: z.number().int().min(1) }).strict();

  /** Restore a prior version's content as a NEW version (forward-only history). */
  async revert(moduleId: string, editorId: string, versionNumber: number): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const m = await maybeOne<{ current_version: number }>(
        c,
        `SELECT current_version FROM modules WHERE module_id = $1 FOR UPDATE`,
        [moduleId],
      );
      if (!m) throw new ApiError("NOT_FOUND", "Module not found");
      const prior = await maybeOne<{ lesson_content: string }>(
        c,
        `SELECT lesson_content FROM module_versions WHERE module_id = $1 AND version_number = $2`,
        [moduleId, versionNumber],
      );
      if (!prior) throw new ApiError("NOT_FOUND", "Version not found");

      const next = m.current_version + 1;
      await c.query(
        `INSERT INTO module_versions (module_id, version_number, lesson_content, edited_by)
         VALUES ($1,$2,$3,$4)`,
        [moduleId, next, prior.lesson_content, editorId],
      );
      await c.query(`UPDATE modules SET lesson_content = $1, current_version = $2 WHERE module_id = $3`, [
        prior.lesson_content,
        next,
        moduleId,
      ]);
      await recordChange(c, "modules", moduleId, editorId, "upsert");
      await audit(c, editorId, "module.reverted", "modules", moduleId, { from_version: versionNumber, new_version: next });
      return this.fetchModule(c, moduleId);
    });
  }

  // ===================== QUESTION BANK =====================

  async listQuestions(moduleId: string): Promise<unknown[]> {
    const m = await maybeOne(this.pool, `SELECT 1 FROM modules WHERE module_id = $1`, [moduleId]);
    if (!m) throw new ApiError("NOT_FOUND", "Module not found");
    return many(
      this.pool,
      `SELECT question_id, module_id, q_type, question_text, answer_options, correct_answer,
              difficulty_rating, is_active, explanation, points
         FROM question_bank WHERE module_id = $1 AND archived_at IS NULL ORDER BY question_id`,
      [moduleId],
    );
  }

  static readonly AddQuestions = z.object({ questions: z.array(QuestionInput).min(1) });

  async addQuestions(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.AddQuestions>,
  ): Promise<{ added: number }> {
    for (const q of input.questions) validateQuestion(q);
    return tx(this.pool, async (c) => {
      const m = await maybeOne(c, `SELECT 1 FROM modules WHERE module_id = $1`, [moduleId]);
      if (!m) throw new ApiError("NOT_FOUND", "Module not found");
      for (const q of input.questions) {
        await c.query(
          `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, explanation, points, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,1),COALESCE($9,TRUE))`,
          [
            moduleId,
            q.q_type,
            q.question_text,
            q.answer_options ? JSON.stringify(q.answer_options) : null,
            q.correct_answer,
            q.difficulty_rating,
            q.explanation ?? null,
            q.points ?? null,
            q.is_active ?? null,
          ],
        );
      }
      await audit(c, editorId, "module.questions_added", "modules", moduleId, { count: input.questions.length });
      return { added: input.questions.length };
    });
  }

  static readonly UpdateQuestion = QuestionInput.partial().extend({
    is_active: z.boolean().optional(),
  });

  async updateQuestion(
    questionId: string,
    editorId: string,
    input: z.infer<typeof AdminCurriculumService.UpdateQuestion>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cur = await maybeOne<QuestionInput & { is_active: boolean; answer_options: string[] | null }>(
        c,
        `SELECT q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active, explanation, points
           FROM question_bank WHERE question_id = $1 FOR UPDATE`,
        [questionId],
      );
      if (!cur) throw new ApiError("NOT_FOUND", "Question not found");
      // Validate the merged result so partial edits can't produce an invalid question.
      const merged: QuestionInput = {
        q_type: input.q_type ?? cur.q_type,
        question_text: input.question_text ?? cur.question_text,
        answer_options: input.answer_options ?? cur.answer_options ?? undefined,
        correct_answer: input.correct_answer ?? cur.correct_answer,
        difficulty_rating: input.difficulty_rating ?? cur.difficulty_rating,
        explanation: input.explanation ?? cur.explanation ?? null,
        points: input.points ?? cur.points ?? 1,
      };
      validateQuestion(merged);

      await c.query(
        `UPDATE question_bank
            SET q_type = $2, question_text = $3, answer_options = $4, correct_answer = $5,
                difficulty_rating = $6, is_active = $7, explanation = $8, points = $9
          WHERE question_id = $1`,
        [
          questionId,
          merged.q_type,
          merged.question_text,
          merged.answer_options ? JSON.stringify(merged.answer_options) : null,
          merged.correct_answer,
          merged.difficulty_rating,
          input.is_active ?? cur.is_active,
          merged.explanation ?? null,
          merged.points ?? 1,
        ],
      );
      await audit(c, editorId, "question.updated", "question_bank", questionId, {});
      return one(c, `SELECT * FROM question_bank WHERE question_id = $1`, [questionId]);
    });
  }

  /**
   * Soft-delete (archive) so existing attempts that reference it keep their FK (§2).
   * Clearing is_active alongside archived_at means every delivery/scoring query
   * (all of which filter WHERE is_active) drops it with no further change, while
   * the builder hides it via archived_at IS NULL — distinct from a "draft".
   */
  async deleteQuestion(questionId: string, editorId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const q = await maybeOne(c, `SELECT 1 FROM question_bank WHERE question_id = $1`, [questionId]);
      if (!q) throw new ApiError("NOT_FOUND", "Question not found");
      await c.query(`UPDATE question_bank SET is_active = FALSE, archived_at = now() WHERE question_id = $1`, [questionId]);
      await audit(c, editorId, "question.deleted", "question_bank", questionId, {});
      return { deleted: true };
    });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}
