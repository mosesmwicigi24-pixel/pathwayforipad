// Growth domains (Contract Matrix B6): spiritual-gifts assessment, private
// prayer journal, saved verses. Gifts are scored SERVER-side (§1.1) from the
// member's Likert answers; the journal and verse library are user-scoped,
// offline-synced (client-generated ids, LWW on updated_at, §1.7) and have no
// leader/admin read path — prayers are pastorally private (§5.4).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, recordChange, tx, recordActivityEvent } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export interface GiftProfile {
  assessment_id: string;
  scores: Record<string, number>;
  top_gifts: string[];
  submitted_at: string;
  duplicate: boolean;
}

export class GrowthService {
  constructor(private readonly pool: Pool) {}

  // ---- Spiritual gifts ----

  static readonly GiftsSubmission = z.object({
    client_mutation_id: z.string().uuid(),
    answers: z
      .array(z.object({ question_id: z.string().uuid(), value: z.number().int().min(1).max(5) }))
      .min(1),
  });

  async giftQuestions(): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT question_id, gift_key, prompt, sort FROM gift_questions WHERE is_active ORDER BY sort`,
    );
    return { data };
  }

  /** Score over the FULL active bank: unanswered items count as 0, so a client
   *  cannot inflate a gift by omitting its low-scoring questions. */
  async submitGifts(userId: string, sub: z.infer<typeof GrowthService.GiftsSubmission>): Promise<GiftProfile> {
    return tx(this.pool, async (c) => {
      const dup = await maybeOne<{ assessment_id: string; scores: Record<string, number>; top_gifts: string[]; submitted_at: string }>(
        c,
        `SELECT assessment_id, scores, top_gifts, submitted_at FROM gift_assessments WHERE client_mutation_id = $1`,
        [sub.client_mutation_id],
      );
      if (dup) return { ...dup, duplicate: true };

      const bank = await many<{ question_id: string; gift_key: string }>(
        c,
        `SELECT question_id, gift_key FROM gift_questions WHERE is_active`,
      );
      if (bank.length === 0) throw new ApiError("UNPROCESSABLE", "Gifts assessment is not configured");

      const given = new Map(sub.answers.map((a) => [a.question_id, a.value]));
      const sums = new Map<string, { got: number; max: number }>();
      for (const q of bank) {
        const agg = sums.get(q.gift_key) ?? { got: 0, max: 0 };
        agg.got += given.get(q.question_id) ?? 0;
        agg.max += 5;
        sums.set(q.gift_key, agg);
      }
      const scores: Record<string, number> = {};
      for (const [gift, { got, max }] of sums) scores[gift] = Math.round((got / max) * 100);
      const top = [...sums.keys()]
        .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))
        .slice(0, 3);

      const row = await one<{ assessment_id: string; submitted_at: string }>(
        c,
        `INSERT INTO gift_assessments (user_id, scores, top_gifts, client_mutation_id)
         VALUES ($1, $2, $3, $4) RETURNING assessment_id, submitted_at`,
        [userId, JSON.stringify(scores), top, sub.client_mutation_id],
      );
      await recordChange(c, "gift_assessments", row.assessment_id, userId, "upsert");
      return { assessment_id: row.assessment_id, scores, top_gifts: top, submitted_at: row.submitted_at, duplicate: false };
    });
  }

  /** Latest gift profile + "where to serve" tracks matched to the top gifts. */
  async myGifts(userId: string): Promise<unknown> {
    const latest = await maybeOne<{ assessment_id: string; scores: Record<string, number>; top_gifts: string[]; submitted_at: string }>(
      this.pool,
      `SELECT assessment_id, scores, top_gifts, submitted_at FROM gift_assessments
        WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [userId],
    );
    if (!latest) return { assessment: null, suggested_tracks: [] };
    const tracks = await many(
      this.pool,
      `SELECT track_key, title, description, gift_keys,
              cardinality(ARRAY(SELECT unnest(gift_keys) INTERSECT SELECT unnest($1::text[])))::int AS match_count
         FROM serving_tracks
        WHERE gift_keys && $1::text[]
        ORDER BY match_count DESC, track_key`,
      [latest.top_gifts],
    );
    return { assessment: latest, suggested_tracks: tracks };
  }

  // ---- Prayer journal (private, offline-synced) ----

  static readonly PrayerUpsert = z.object({
    entry_id: z.string().uuid(), // client-generated (offline-first)
    title: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(10_000),
    is_answered: z.boolean().default(false),
    answered_note: z.string().max(2000).nullable().optional(),
    updated_at: z.string().datetime().optional(), // LWW anchor; defaults to now
    client_mutation_id: z.string().uuid().optional(),
  });

  /** LWW upsert: an older replay never clobbers a newer write (§1.7). */
  async upsertPrayer(
    userId: string,
    input: z.infer<typeof GrowthService.PrayerUpsert>,
  ): Promise<{ entry_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ entry_id: string }>(
          c,
          `SELECT entry_id FROM prayer_entries WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { entry_id: dup.entry_id, duplicate: true };
      }
      const updatedAt = input.updated_at ?? new Date().toISOString();
      const res = await c.query(
        `INSERT INTO prayer_entries
           (entry_id, user_id, title, body, is_answered, answered_note, answered_at, updated_at, client_mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 THEN now() END, $7, $8)
         ON CONFLICT (entry_id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body,
           is_answered = EXCLUDED.is_answered, answered_note = EXCLUDED.answered_note,
           answered_at = CASE WHEN EXCLUDED.is_answered AND NOT prayer_entries.is_answered THEN now()
                              WHEN NOT EXCLUDED.is_answered THEN NULL
                              ELSE prayer_entries.answered_at END,
           updated_at = EXCLUDED.updated_at, client_mutation_id = EXCLUDED.client_mutation_id
         WHERE prayer_entries.user_id = EXCLUDED.user_id          -- never touch another member's entry
           AND prayer_entries.updated_at <= EXCLUDED.updated_at   -- LWW
         RETURNING entry_id`,
        [
          input.entry_id,
          userId,
          input.title ?? null,
          input.body,
          input.is_answered,
          input.answered_note ?? null,
          updatedAt,
          input.client_mutation_id ?? null,
        ],
      );
      if (res.rowCount === 0) {
        // Row exists but is newer (stale replay) or belongs to someone else.
        const owner = await maybeOne<{ user_id: string }>(
          c,
          `SELECT user_id FROM prayer_entries WHERE entry_id = $1`,
          [input.entry_id],
        );
        if (owner && owner.user_id !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Not your journal entry");
        return { entry_id: input.entry_id, duplicate: true }; // stale LWW replay → no-op
      }
      await recordChange(c, "prayer_entries", input.entry_id, userId, "upsert");
      // Praying (a real journal entry) ticks the daily "prayer" rhythm + feeds the
      // Prayer score / streak — so the rhythm reflects actual prayer, not a tap.
      await recordActivityEvent(c, userId, "prayer", { oncePerDayTz: "Africa/Nairobi" });
      return { entry_id: input.entry_id, duplicate: false };
    });
  }

  /** HARD delete (member privacy) + tombstone so every device drops it. */
  async deletePrayer(userId: string, entryId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const res = await c.query(`DELETE FROM prayer_entries WHERE entry_id = $1 AND user_id = $2`, [entryId, userId]);
      if ((res.rowCount ?? 0) > 0) await recordChange(c, "prayer_entries", entryId, userId, "delete");
      return { deleted: (res.rowCount ?? 0) > 0 }; // idempotent: re-delete is a calm no-op
    });
  }

  async myPrayers(userId: string): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT entry_id, title, body, is_answered, answered_note, answered_at, created_at, updated_at
         FROM prayer_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [userId],
    );
    return { data };
  }

  // ---- Saved verses ----

  static readonly VerseSave = z.object({
    saved_verse_id: z.string().uuid(), // client-generated
    reference: z.string().min(3).max(80),
    version: z.string().min(2).max(12).default("KJV"),
    verse_text: z.string().max(2000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  async saveVerse(
    userId: string,
    input: z.infer<typeof GrowthService.VerseSave>,
  ): Promise<{ saved_verse_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ saved_verse_id: string }>(
          c,
          `SELECT saved_verse_id FROM saved_verses WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { saved_verse_id: dup.saved_verse_id, duplicate: true };
      }
      // Same verse+version saved again just refreshes the note (dedup key).
      const row = await one<{ saved_verse_id: string }>(
        c,
        `INSERT INTO saved_verses (saved_verse_id, user_id, reference, version, verse_text, note, client_mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, reference, version) DO UPDATE SET
           verse_text = COALESCE(EXCLUDED.verse_text, saved_verses.verse_text),
           note = EXCLUDED.note, updated_at = now(), client_mutation_id = EXCLUDED.client_mutation_id
         RETURNING saved_verse_id`,
        [
          input.saved_verse_id,
          userId,
          input.reference,
          input.version,
          input.verse_text ?? null,
          input.note ?? null,
          input.client_mutation_id ?? null,
        ],
      );
      await recordChange(c, "saved_verses", row.saved_verse_id, userId, "upsert");
      return { saved_verse_id: row.saved_verse_id, duplicate: false };
    });
  }

  async deleteVerse(userId: string, savedVerseId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const res = await c.query(`DELETE FROM saved_verses WHERE saved_verse_id = $1 AND user_id = $2`, [
        savedVerseId,
        userId,
      ]);
      if ((res.rowCount ?? 0) > 0) await recordChange(c, "saved_verses", savedVerseId, userId, "delete");
      return { deleted: (res.rowCount ?? 0) > 0 };
    });
  }

  async myVerses(userId: string): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT saved_verse_id, reference, version, verse_text, note, created_at
         FROM saved_verses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [userId],
    );
    return { data };
  }
}
