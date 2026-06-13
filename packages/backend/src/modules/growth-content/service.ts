// Growth content (Contract Matrix D5). Church-curated content (devotionals,
// memory verses, reading plans, resources) + per-member progress (verse mastery,
// reading-plan days). Mentor view derives the discipler from relationship_tree
// (§1.1 — measurement, not ministry) plus the conversation log. Content reads
// are shared; progress is private to the member (§5.4) and idempotent on
// (user, item) for offline-tolerant replay (§3.6).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export class GrowthContentService {
  constructor(private readonly pool: Pool) {}

  // ---- Devotionals ----

  /** Today's devotional = the highest published day_number (church paces it). */
  async todayDevotional(): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `SELECT devotional_id, day_number, series, title, scripture_ref, scripture_text,
              body, reflection_prompt, audio_url, video_url
         FROM devotionals WHERE is_published ORDER BY day_number DESC LIMIT 1`,
    );
    if (!row) throw new ApiError("NOT_FOUND", "No devotional published yet");
    return row;
  }

  // ---- Memory verses (library + my mastery) ----

  async memoryVerses(userId: string): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT mv.memory_verse_id, mv.reference, mv.verse_text, mv.version, mv.week_number,
              COALESCE(p.status, 'learning') AS status,
              COALESCE(p.best_match_pct, 0)  AS best_match_pct
         FROM memory_verses mv
         LEFT JOIN memory_verse_progress p
           ON p.memory_verse_id = mv.memory_verse_id AND p.user_id = $1
        WHERE mv.is_active
        ORDER BY mv.sort, mv.reference`,
      [userId],
    );
    return { data };
  }

  static readonly Practice = z.object({
    memory_verse_id: z.string().uuid(),
    match_pct: z.number().int().min(0).max(100),
  });

  /** Record a practice attempt; mastered once the best match reaches 90%. */
  async practiceVerse(userId: string, input: z.infer<typeof GrowthContentService.Practice>): Promise<unknown> {
    const status = input.match_pct >= 90 ? "mastered" : "learning";
    return one(
      this.pool,
      `INSERT INTO memory_verse_progress (user_id, memory_verse_id, status, best_match_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, memory_verse_id) DO UPDATE SET
         best_match_pct = GREATEST(memory_verse_progress.best_match_pct, EXCLUDED.best_match_pct),
         status = CASE WHEN GREATEST(memory_verse_progress.best_match_pct, EXCLUDED.best_match_pct) >= 90
                       THEN 'mastered' ELSE memory_verse_progress.status END,
         updated_at = now()
       RETURNING memory_verse_id, status, best_match_pct`,
      [userId, input.memory_verse_id, status, input.match_pct],
    );
  }

  // ---- Reading plans ----

  async plans(userId: string): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT p.plan_id, p.code, p.title, p.description, p.category, p.day_count,
              pr.current_day, pr.completed_days, (pr.user_id IS NOT NULL) AS enrolled,
              pr.completed_at
         FROM reading_plans p
         LEFT JOIN reading_plan_progress pr ON pr.plan_id = p.plan_id AND pr.user_id = $1
        WHERE p.is_active
        ORDER BY p.sort, p.title`,
      [userId],
    );
    return { data };
  }

  async planDetail(userId: string, planId: string): Promise<unknown> {
    const plan = await maybeOne(
      this.pool,
      `SELECT p.plan_id, p.title, p.description, p.category, p.day_count,
              pr.current_day, pr.completed_days, (pr.user_id IS NOT NULL) AS enrolled
         FROM reading_plans p
         LEFT JOIN reading_plan_progress pr ON pr.plan_id = p.plan_id AND pr.user_id = $1
        WHERE p.plan_id = $2 AND p.is_active`,
      [userId, planId],
    );
    if (!plan) throw new ApiError("NOT_FOUND", "Reading plan not found");
    const days = await many(
      this.pool,
      `SELECT day_number, reference, title, content FROM reading_plan_days
        WHERE plan_id = $1 ORDER BY day_number`,
      [planId],
    );
    return { ...plan, days };
  }

  /** Enroll (idempotent) — first read starts the plan. */
  async startPlan(userId: string, planId: string): Promise<unknown> {
    const exists = await maybeOne(this.pool, `SELECT 1 FROM reading_plans WHERE plan_id = $1 AND is_active`, [planId]);
    if (!exists) throw new ApiError("NOT_FOUND", "Reading plan not found");
    return one(
      this.pool,
      `INSERT INTO reading_plan_progress (user_id, plan_id) VALUES ($1, $2)
       ON CONFLICT (user_id, plan_id) DO UPDATE SET updated_at = now()
       RETURNING plan_id, current_day, completed_days`,
      [userId, planId],
    );
  }

  static readonly CompleteDay = z.object({ day_number: z.number().int().min(1) });

  /** Mark a day complete; advances current_day and stamps completion when done. */
  async completeDay(
    userId: string,
    planId: string,
    input: z.infer<typeof GrowthContentService.CompleteDay>,
  ): Promise<unknown> {
    const plan = await maybeOne<{ day_count: number }>(
      this.pool,
      `SELECT day_count FROM reading_plans WHERE plan_id = $1 AND is_active`,
      [planId],
    );
    if (!plan) throw new ApiError("NOT_FOUND", "Reading plan not found");
    if (input.day_number > plan.day_count) throw new ApiError("VALIDATION_FAILED", "Day beyond the plan length");
    return one(
      this.pool,
      `INSERT INTO reading_plan_progress (user_id, plan_id, current_day, completed_days)
       VALUES ($1, $2, LEAST($3 + 1, $4), ARRAY[$3]::int[])
       ON CONFLICT (user_id, plan_id) DO UPDATE SET
         completed_days = (
           SELECT ARRAY(SELECT DISTINCT unnest(reading_plan_progress.completed_days || $3) ORDER BY 1)
         ),
         current_day = LEAST(GREATEST(reading_plan_progress.current_day, $3 + 1), $4),
         completed_at = CASE
           WHEN cardinality(ARRAY(SELECT DISTINCT unnest(reading_plan_progress.completed_days || $3))) >= $4
           THEN now() ELSE reading_plan_progress.completed_at END,
         updated_at = now()
       RETURNING plan_id, current_day, completed_days, completed_at`,
      [userId, planId, input.day_number, plan.day_count],
    );
  }

  // ---- Resources ----

  async resources(): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT resource_id, title, author, kind, duration_label, url
         FROM resources WHERE is_active ORDER BY sort, title`,
    );
    return { data };
  }

  // ---- Mentor (discipler + conversation log) ----

  async mentor(userId: string): Promise<unknown> {
    const mentor = await maybeOne(
      this.pool,
      `SELECT u.user_id AS mentor_user_id, u.full_name, cg.name AS cell_name, rt.established_at
         FROM relationship_tree rt
         JOIN users u ON u.user_id = rt.multiplier_id
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
        WHERE rt.disciple_id = $1`,
      [userId],
    );
    const notes = await many(
      this.pool,
      `SELECT note_id, topic, note, met_at, next_meeting_at
         FROM mentor_notes WHERE user_id = $1 ORDER BY met_at DESC LIMIT 20`,
      [userId],
    );
    const nextMeeting = await maybeOne<{ next_meeting_at: string }>(
      this.pool,
      `SELECT next_meeting_at FROM mentor_notes
        WHERE user_id = $1 AND next_meeting_at IS NOT NULL AND next_meeting_at > now()
        ORDER BY next_meeting_at ASC LIMIT 1`,
      [userId],
    );
    return { mentor, next_meeting_at: nextMeeting?.next_meeting_at ?? null, notes };
  }
}
