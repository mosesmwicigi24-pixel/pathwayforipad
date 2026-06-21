// Level-encouragements service. Member read (active rows for a level, ordered)
// + Admin CRUD. Server-authoritative; admin writes are audited. Mirrors the
// growth-content authoring pattern (Contract Matrix D5).
import type { Pool } from "pg";
import { z } from "zod";
import { many, one, maybeOne, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const SELECT_COLS = `encouragement_id, level_number, after_module_sequence, kind,
  title, body, image_url, scripture_ref, emoji, is_active, sort_order`;

export class EncouragementsService {
  constructor(private readonly pool: Pool) {}

  static readonly Input = z
    .object({
      after_module_sequence: z.coerce.number().int().min(0).optional(),
      kind: z.enum(["splash", "cheer", "sticker", "note"]).optional(),
      title: z.string().max(200).optional(),
      body: z.string().max(2000).optional(),
      image_url: z.string().max(512).optional(),
      scripture_ref: z.string().max(80).optional(),
      emoji: z.string().max(16).optional(),
      is_active: z.boolean().optional(),
      sort_order: z.coerce.number().int().optional(),
    })
    .strict();

  // ---- Member read: active encouragements for a level, in trail order ----
  listForLevel(level: number): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT ${SELECT_COLS} FROM level_encouragements
       WHERE level_number = $1 AND is_active = true
       ORDER BY after_module_sequence, sort_order, created_at`,
      [level],
    );
  }

  // ---- Admin reads/writes ----
  adminList(level: number): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT ${SELECT_COLS} FROM level_encouragements
       WHERE level_number = $1 ORDER BY after_module_sequence, sort_order, created_at`,
      [level],
    );
  }

  async create(adminId: string, level: number, input: z.infer<typeof EncouragementsService.Input>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ encouragement_id: string }>(
        c,
        `INSERT INTO level_encouragements
           (level_number, after_module_sequence, kind, title, body, image_url, scripture_ref, emoji, is_active, sort_order)
         VALUES ($1, COALESCE($2,0), COALESCE($3,'splash'), $4, $5, $6, $7, $8, COALESCE($9,TRUE), COALESCE($10,0))
         RETURNING encouragement_id`,
        [
          level, input.after_module_sequence ?? null, input.kind ?? null, input.title ?? null,
          input.body ?? null, input.image_url ?? null, input.scripture_ref ?? null, input.emoji ?? null,
          input.is_active ?? null, input.sort_order ?? null,
        ],
      );
      await audit(c, adminId, "encouragement.created", "level_encouragements", row.encouragement_id, { level_number: level });
      return one(c, `SELECT ${SELECT_COLS} FROM level_encouragements WHERE encouragement_id = $1`, [row.encouragement_id]);
    });
  }

  async update(adminId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cols = ["after_module_sequence", "kind", "title", "body", "image_url", "scripture_ref", "emoji", "is_active", "sort_order"];
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const col of cols) {
        if (col in input && input[col] !== undefined) {
          params.push(input[col]);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (sets.length > 0) {
        sets.push(`updated_at = now()`);
        await c.query(`UPDATE level_encouragements SET ${sets.join(", ")} WHERE encouragement_id = $${params.length + 1}`, [...params, id]);
      }
      const row = await maybeOne(c, `SELECT ${SELECT_COLS} FROM level_encouragements WHERE encouragement_id = $1`, [id]);
      if (!row) throw new ApiError("NOT_FOUND", "Encouragement not found");
      await audit(c, adminId, "encouragement.updated", "level_encouragements", id, {});
      return row;
    });
  }

  async remove(adminId: string, id: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`DELETE FROM level_encouragements WHERE encouragement_id = $1`, [id]);
      await audit(c, adminId, "encouragement.deleted", "level_encouragements", id, {});
      return { deleted: (r.rowCount ?? 0) > 0 };
    });
  }
}
