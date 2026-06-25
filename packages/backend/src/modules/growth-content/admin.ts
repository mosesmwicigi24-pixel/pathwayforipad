// Growth-content authoring (Admin+). CRUD for the mobile growth surfaces that
// were previously seed-only: devotionals, memory verses, reading plans (+ days)
// and the resource library. Every mobile element is now editable from the portal.
// Server-authoritative; audited. Member-facing reads stay in service.ts.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { many, one, maybeOne, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const segmentInput = z.object({
  sort: z.coerce.number().int().min(0).optional(),
  kind: z.enum(["devotional", "scripture", "video", "talk", "reading"]).optional(),
  title: z.string().min(1).max(200),
  reference: z.string().max(160).optional(),
  content: z.string().optional(),
  video_url: z.string().max(2048).optional(),
  image_url: z.string().max(2048).optional(),
});
const dayInput = z.object({
  day_number: z.coerce.number().int().min(1),
  reference: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  segments: z.array(segmentInput).optional(),
});

export class AdminGrowthService {
  constructor(private readonly pool: Pool) {}

  // ---------------- Devotionals ----------------
  static readonly Devotional = z
    .object({
      day_number: z.coerce.number().int().min(1),
      series: z.string().max(120).optional(),
      title: z.string().min(1).max(200),
      scripture_ref: z.string().max(80).optional(),
      scripture_text: z.string().optional(),
      body: z.string().min(1),
      reflection_prompt: z.string().optional(),
      audio_url: z.string().max(512).optional(),
      video_url: z.string().max(512).optional(),
      is_published: z.boolean().optional(),
    })
    .strict();

  listDevotionals(): Promise<unknown[]> {
    return many(this.pool, `SELECT * FROM devotionals ORDER BY day_number`);
  }
  async createDevotional(adminId: string, input: z.infer<typeof AdminGrowthService.Devotional>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ devotional_id: string }>(
        c,
        `INSERT INTO devotionals (day_number, series, title, scripture_ref, scripture_text, body, reflection_prompt, audio_url, video_url, is_published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, TRUE)) RETURNING devotional_id`,
        [input.day_number, input.series ?? null, input.title, input.scripture_ref ?? null, input.scripture_text ?? null, input.body, input.reflection_prompt ?? null, input.audio_url ?? null, input.video_url ?? null, input.is_published ?? null],
      );
      await audit(c, adminId, "growth.devotional_created", "devotionals", row.devotional_id, { day_number: input.day_number });
      return one(c, `SELECT * FROM devotionals WHERE devotional_id = $1`, [row.devotional_id]);
    });
  }
  async updateDevotional(adminId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const { sql, params } = setClause(input, ["day_number", "series", "title", "scripture_ref", "scripture_text", "body", "reflection_prompt", "audio_url", "video_url", "is_published"]);
      if (sql) await c.query(`UPDATE devotionals SET ${sql} WHERE devotional_id = $${params.length + 1}`, [...params, id]);
      const row = await maybeOne(c, `SELECT * FROM devotionals WHERE devotional_id = $1`, [id]);
      if (!row) throw new ApiError("NOT_FOUND", "Devotional not found");
      await audit(c, adminId, "growth.devotional_updated", "devotionals", id, {});
      return row;
    });
  }
  async deleteDevotional(adminId: string, id: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`DELETE FROM devotionals WHERE devotional_id = $1`, [id]);
      await audit(c, adminId, "growth.devotional_deleted", "devotionals", id, {});
      return { deleted: (r.rowCount ?? 0) > 0 };
    });
  }

  // ---------------- Memory verses ----------------
  static readonly Verse = z
    .object({
      reference: z.string().min(1).max(80),
      verse_text: z.string().min(1),
      version: z.string().max(12).optional(),
      week_number: z.coerce.number().int().min(1).nullable().optional(),
      release_date: z.string().max(10).nullable().optional(), // YYYY-MM-DD
      sort: z.coerce.number().int().optional(),
      is_active: z.boolean().optional(),
    })
    .strict();

  listVerses(): Promise<unknown[]> {
    return many(this.pool, `SELECT * FROM memory_verses ORDER BY sort, reference`);
  }
  async createVerse(adminId: string, input: z.infer<typeof AdminGrowthService.Verse>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ memory_verse_id: string }>(
        c,
        `INSERT INTO memory_verses (reference, verse_text, version, week_number, release_date, sort, is_active)
         VALUES ($1,$2,COALESCE($3,'WEB'),$4,$5,COALESCE($6,0),COALESCE($7,TRUE)) RETURNING memory_verse_id`,
        [input.reference, input.verse_text, input.version ?? null, input.week_number ?? null, input.release_date ?? null, input.sort ?? null, input.is_active ?? null],
      );
      await audit(c, adminId, "growth.verse_created", "memory_verses", row.memory_verse_id, {});
      return one(c, `SELECT * FROM memory_verses WHERE memory_verse_id = $1`, [row.memory_verse_id]);
    });
  }
  async updateVerse(adminId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const { sql, params } = setClause(input, ["reference", "verse_text", "version", "week_number", "release_date", "sort", "is_active"]);
      if (sql) await c.query(`UPDATE memory_verses SET ${sql} WHERE memory_verse_id = $${params.length + 1}`, [...params, id]);
      const row = await maybeOne(c, `SELECT * FROM memory_verses WHERE memory_verse_id = $1`, [id]);
      if (!row) throw new ApiError("NOT_FOUND", "Verse not found");
      await audit(c, adminId, "growth.verse_updated", "memory_verses", id, {});
      return row;
    });
  }
  async deleteVerse(adminId: string, id: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`DELETE FROM memory_verses WHERE memory_verse_id = $1`, [id]);
      await audit(c, adminId, "growth.verse_deleted", "memory_verses", id, {});
      return { deleted: (r.rowCount ?? 0) > 0 };
    });
  }

  // ---------------- Reading plans (+ days) ----------------
  static readonly Plan = z
    .object({
      code: z.string().min(1).max(40),
      title: z.string().min(1).max(200),
      subtitle: z.string().max(200).optional(),
      description: z.string().optional(),
      category: z.string().max(80).optional(),
      image_url: z.string().max(2048).optional(),
      sort: z.coerce.number().int().optional(),
      is_active: z.boolean().optional(),
      days: z.array(dayInput).min(1),
    })
    .strict();

  async listPlans(): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT p.*, (SELECT count(*)::int FROM reading_plan_days d WHERE d.plan_id = p.plan_id) AS day_total
         FROM reading_plans p ORDER BY p.sort, p.title`,
    );
  }
  async planDetail(id: string): Promise<unknown> {
    const plan = await maybeOne(this.pool, `SELECT * FROM reading_plans WHERE plan_id = $1`, [id]);
    if (!plan) throw new ApiError("NOT_FOUND", "Plan not found");
    const days = await many<{ plan_day_id: string }>(this.pool, `SELECT * FROM reading_plan_days WHERE plan_id = $1 ORDER BY day_number`, [id]);
    const segs = await many<{ plan_day_id: string }>(
      this.pool,
      `SELECT s.* FROM reading_plan_day_segments s
         JOIN reading_plan_days d ON d.plan_day_id = s.plan_day_id
        WHERE d.plan_id = $1 ORDER BY s.sort`,
      [id],
    );
    const byDay = new Map<string, unknown[]>();
    for (const s of segs) { const l = byDay.get(s.plan_day_id) ?? []; l.push(s); byDay.set(s.plan_day_id, l); }
    return { ...plan, days: days.map((d) => ({ ...d, segments: byDay.get(d.plan_day_id) ?? [] })) };
  }
  async createPlan(adminId: string, input: z.infer<typeof AdminGrowthService.Plan>): Promise<unknown> {
    const planId = await tx(this.pool, async (c) => {
      const plan = await one<{ plan_id: string }>(
        c,
        `INSERT INTO reading_plans (code, title, subtitle, description, category, image_url, day_count, sort, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),COALESCE($9,TRUE)) RETURNING plan_id`,
        [input.code, input.title, input.subtitle ?? null, input.description ?? null, input.category ?? null, input.image_url ?? null, input.days.length, input.sort ?? null, input.is_active ?? null],
      );
      await this.replaceDays(c, plan.plan_id, input.days);
      await audit(c, adminId, "growth.plan_created", "reading_plans", plan.plan_id, { code: input.code });
      return plan.plan_id;
    });
    return this.planDetail(planId);
  }
  async updatePlan(adminId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    await tx(this.pool, async (c) => {
      const exists = await maybeOne(c, `SELECT 1 FROM reading_plans WHERE plan_id = $1`, [id]);
      if (!exists) throw new ApiError("NOT_FOUND", "Plan not found");
      const { sql, params } = setClause(input, ["code", "title", "subtitle", "description", "category", "image_url", "sort", "is_active"]);
      if (sql) await c.query(`UPDATE reading_plans SET ${sql} WHERE plan_id = $${params.length + 1}`, [...params, id]);
      const days = input.days as z.infer<typeof dayInput>[] | undefined;
      if (days) {
        await this.replaceDays(c, id, days);
        await c.query(`UPDATE reading_plans SET day_count = $1 WHERE plan_id = $2`, [days.length, id]);
      }
      await audit(c, adminId, "growth.plan_updated", "reading_plans", id, {});
    });
    return this.planDetail(id);
  }
  async deletePlan(adminId: string, id: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`DELETE FROM reading_plans WHERE plan_id = $1`, [id]);
      await audit(c, adminId, "growth.plan_deleted", "reading_plans", id, {});
      return { deleted: (r.rowCount ?? 0) > 0 };
    });
  }
  private async replaceDays(c: PoolClient, planId: string, days: z.infer<typeof dayInput>[]): Promise<void> {
    await c.query(`DELETE FROM reading_plan_days WHERE plan_id = $1`, [planId]);
    for (const d of days) {
      const dayRow = await one<{ plan_day_id: string }>(
        c,
        `INSERT INTO reading_plan_days (plan_id, day_number, reference, title, content)
         VALUES ($1,$2,$3,$4,$5) RETURNING plan_day_id`,
        [planId, d.day_number, d.reference, d.title ?? null, d.content ?? null],
      );
      const segments = d.segments ?? [];
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i]!;
        await c.query(
          `INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [dayRow.plan_day_id, s.sort ?? i, s.kind ?? "reading", s.title, s.reference ?? null, s.content ?? null, s.video_url ?? null, s.image_url ?? null],
        );
      }
    }
  }

  // ---------------- Resources ----------------
  static readonly Resource = z
    .object({
      title: z.string().min(1).max(200),
      author: z.string().max(160).optional(),
      kind: z.enum(["book", "audio", "video", "article"]),
      duration_label: z.string().max(40).optional(),
      url: z.string().max(512).optional(),
      sort: z.coerce.number().int().optional(),
      is_active: z.boolean().optional(),
    })
    .strict();

  listResources(): Promise<unknown[]> {
    return many(this.pool, `SELECT * FROM resources ORDER BY sort, title`);
  }
  async createResource(adminId: string, input: z.infer<typeof AdminGrowthService.Resource>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ resource_id: string }>(
        c,
        `INSERT INTO resources (title, author, kind, duration_label, url, sort, is_active)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,TRUE)) RETURNING resource_id`,
        [input.title, input.author ?? null, input.kind, input.duration_label ?? null, input.url ?? null, input.sort ?? null, input.is_active ?? null],
      );
      await audit(c, adminId, "growth.resource_created", "resources", row.resource_id, { kind: input.kind });
      return one(c, `SELECT * FROM resources WHERE resource_id = $1`, [row.resource_id]);
    });
  }
  async updateResource(adminId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const { sql, params } = setClause(input, ["title", "author", "kind", "duration_label", "url", "sort", "is_active"]);
      if (sql) await c.query(`UPDATE resources SET ${sql} WHERE resource_id = $${params.length + 1}`, [...params, id]);
      const row = await maybeOne(c, `SELECT * FROM resources WHERE resource_id = $1`, [id]);
      if (!row) throw new ApiError("NOT_FOUND", "Resource not found");
      await audit(c, adminId, "growth.resource_updated", "resources", id, {});
      return row;
    });
  }
  async deleteResource(adminId: string, id: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`DELETE FROM resources WHERE resource_id = $1`, [id]);
      await audit(c, adminId, "growth.resource_deleted", "resources", id, {});
      return { deleted: (r.rowCount ?? 0) > 0 };
    });
  }
}

/** Build a partial `col = $n` SET clause from the provided keys only. */
function setClause(input: Record<string, unknown>, cols: string[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  for (const col of cols) {
    if (Object.prototype.hasOwnProperty.call(input, col) && input[col] !== undefined) {
      params.push(input[col]);
      parts.push(`${col} = $${params.length}`);
    }
  }
  return { sql: parts.join(", "), params };
}
