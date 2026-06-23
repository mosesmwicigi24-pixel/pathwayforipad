// Growth domains (Contract Matrix B6): spiritual-gifts assessment, private
// prayer journal, saved verses. Gifts are scored SERVER-side (§1.1) from the
// member's Likert answers; the journal and verse library are user-scoped,
// offline-synced (client-generated ids, LWW on updated_at, §1.7) and have no
// leader/admin read path — prayers are pastorally private (§5.4).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, recordChange, tx, recordActivityEvent, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { ScoresService } from "../scores/service.js";
import type { AiProvider } from "../assistant/provider.js";

export interface GiftProfile {
  assessment_id: string;
  scores: Record<string, number>;
  top_gifts: string[];
  submitted_at: string;
  persona_summary: string | null;
  duplicate: boolean;
}

// How a member's engagement (0–100 per axis) biases which gifts we probe more
// deeply. This is influence, not exclusion — every gift keeps baseline coverage.
const GIFT_AXES: Record<string, Partial<Record<"habits" | "curriculum" | "attendance" | "word" | "prayer", number>>> = {
  leadership: { curriculum: 0.5, attendance: 0.5 },
  teaching: { curriculum: 0.6, word: 0.4 },
  service: { habits: 0.6, attendance: 0.4 },
  mercy: { prayer: 0.7, habits: 0.3 },
  evangelism: { attendance: 0.6, word: 0.4 },
  giving: { habits: 0.4, attendance: 0.3, curriculum: 0.3 },
  hospitality: { attendance: 0.6, habits: 0.4 },
};

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

export class GrowthService {
  constructor(private readonly pool: Pool, private readonly provider?: AiProvider) {}

  // ---- Spiritual gifts ----

  static readonly GiftsSubmission = z.object({
    client_mutation_id: z.string().uuid(),
    set_id: z.string().uuid(),
    answers: z
      .array(z.object({ question_id: z.string().uuid(), value: z.number().int().min(1).max(5) }))
      .min(1),
  });

  /** Per-gift probe weight (0.3–1.0) from the member's engagement fingerprint,
   *  optionally refined by Nuru AI. Deterministic + offline-safe by default. */
  private async giftWeights(userId: string): Promise<{ weights: Record<string, number>; ai: boolean }> {
    const all = await new ScoresService(this.pool).all(userId).catch(() => null);
    const axis = (k: string): number => {
      const b = all?.[k] as { score?: number } | undefined;
      return typeof b?.score === "number" ? b.score : 0;
    };
    const s = { habits: axis("habits"), curriculum: axis("curriculum"), attendance: axis("attendance"), word: axis("word"), prayer: axis("prayer") };
    const weights: Record<string, number> = {};
    for (const [gift, axes] of Object.entries(GIFT_AXES)) {
      let v = 0;
      for (const [ax, w] of Object.entries(axes)) v += (w ?? 0) * (s[ax as keyof typeof s] ?? 0);
      weights[gift] = r2(0.5 + 0.5 * Math.max(0, Math.min(100, v)) / 100); // 0.5..1.0
    }
    let ai = false;
    if (this.provider && this.provider.name !== "fake") {
      try {
        const system =
          "You tune a spiritual-gifts questionnaire. Given a member's engagement scores (0-100), return ONLY compact JSON mapping each gift_key to a probe weight between 0.3 and 1.0 (higher = ask more questions about that gift). Keys: leadership, teaching, service, mercy, evangelism, giving, hospitality.";
        const user = `Engagement: ${JSON.stringify(s)}. Baseline weights: ${JSON.stringify(weights)}. JSON only.`;
        const out = await this.provider.complete({ system, messages: [{ role: "user", text: user }] });
        const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as Record<string, number>;
        for (const g of Object.keys(weights)) {
          const v = parsed[g];
          if (typeof v === "number" && Number.isFinite(v)) { weights[g] = Math.max(0.3, Math.min(1, v)); ai = true; }
        }
      } catch { ai = false; }
    }
    return { weights, ai };
  }

  /** Draw a shuffled ~20-question subset, biased by the member's weights but with
   *  baseline coverage of every gift, and persist it so scoring uses this set. */
  private async buildSet(userId: string): Promise<{ set_id: string; ai_influenced: boolean; data: unknown[] }> {
    const bank = await many<{ question_id: string; gift_key: string; prompt: string }>(
      this.pool,
      `SELECT question_id, gift_key, prompt FROM gift_questions WHERE is_active`,
    );
    if (bank.length === 0) throw new ApiError("UNPROCESSABLE", "Gifts assessment is not configured");
    const byGift = new Map<string, typeof bank>();
    for (const q of bank) { const a = byGift.get(q.gift_key) ?? []; a.push(q); byGift.set(q.gift_key, a); }
    const gifts = [...byGift.keys()];
    const N = Math.min(20, bank.length);
    const { weights, ai } = await this.giftWeights(userId);

    const baseline = Math.max(1, Math.min(2, Math.floor(N / Math.max(1, gifts.length))));
    const counts = new Map<string, number>();
    for (const g of gifts) counts.set(g, Math.min(baseline, byGift.get(g)!.length));
    let used = [...counts.values()].reduce((a, b) => a + b, 0);
    const order = [...gifts].sort((a, b) => (weights[b] ?? 0.6) - (weights[a] ?? 0.6));
    while (used < N) {
      let added = false;
      for (const g of order) {
        if (used >= N) break;
        if ((counts.get(g) ?? 0) < byGift.get(g)!.length) { counts.set(g, (counts.get(g) ?? 0) + 1); used++; added = true; }
      }
      if (!added) break;
    }
    const picked: typeof bank = [];
    for (const g of gifts) picked.push(...shuffle([...byGift.get(g)!]).slice(0, counts.get(g) ?? 0));
    const finalQ = shuffle(picked).slice(0, N);
    const ids = finalQ.map((q) => q.question_id);
    const row = await one<{ set_id: string }>(
      this.pool,
      `INSERT INTO gift_question_sets (user_id, question_ids, weights, ai_influenced) VALUES ($1, $2, $3, $4) RETURNING set_id`,
      [userId, ids, JSON.stringify(weights), ai],
    );
    return { set_id: row.set_id, ai_influenced: ai, data: finalQ.map((q) => ({ question_id: q.question_id, gift_key: q.gift_key, prompt: q.prompt })) };
  }

  /** The member's current question set — reuse their open (unsubmitted) draw so
   *  the list is stable across refetches; otherwise draw a fresh personalized set. */
  async giftQuestions(userId: string): Promise<{ set_id: string; ai_influenced: boolean; data: unknown[] }> {
    const open = await maybeOne<{ set_id: string; question_ids: string[]; ai_influenced: boolean }>(
      this.pool,
      `SELECT set_id, question_ids, ai_influenced FROM gift_question_sets
        WHERE user_id = $1 AND submitted_assessment_id IS NULL ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (open && open.question_ids.length > 0) {
      const qs = await many<{ question_id: string; gift_key: string; prompt: string }>(
        this.pool,
        `SELECT question_id, gift_key, prompt FROM gift_questions WHERE question_id = ANY($1) AND is_active`,
        [open.question_ids],
      );
      const m = new Map(qs.map((q) => [q.question_id, q]));
      const data = open.question_ids.map((id) => m.get(id)).filter((q): q is { question_id: string; gift_key: string; prompt: string } => !!q);
      if (data.length > 0) return { set_id: open.set_id, ai_influenced: open.ai_influenced, data };
    }
    return this.buildSet(userId);
  }

  /** A short, personal "gift personality" narrative across the top gifts —
   *  deterministic from persona copy, enhanced by Nuru AI when available. */
  private async composePersona(c: Queryable, top: string[], scores: Record<string, number>): Promise<string | null> {
    const defs = await many<{ gift_key: string; persona_name: string; title: string; summary: string }>(
      c,
      `SELECT gift_key, persona_name, title, summary FROM gift_definitions WHERE gift_key = ANY($1)`,
      [top],
    );
    const byKey = new Map(defs.map((d) => [d.gift_key, d]));
    const ordered = top.map((k) => byKey.get(k)).filter((d): d is NonNullable<typeof d> => !!d);
    if (ordered.length === 0) return null;
    const names = ordered.map((d) => d.persona_name);
    let text = `Your gifting shines as ${names[0]}${names[1] ? `, with ${names[1]}` : ""}${names[2] ? ` and ${names[2]}` : ""}. ${ordered[0]!.summary}`;
    if (this.provider && this.provider.name !== "fake") {
      try {
        const system = "You are Nuru, a warm discipleship guide. In 2-3 sentences, write an encouraging, personal summary of a believer's spiritual-gift personality from their top gifts. Second person, no headings, no lists.";
        const user = `Top gifts: ${ordered.map((d) => `${d.title} (${d.persona_name})`).join(", ")}. Scores: ${JSON.stringify(scores)}.`;
        const out = await this.provider.complete({ system, messages: [{ role: "user", text: user }] });
        if (out && out.trim().length > 20) text = out.trim();
      } catch { /* keep the deterministic narrative */ }
    }
    return text;
  }

  /** Score over the SERVED subset (not the full bank): the denominator is the set
   *  the member was actually given, so a personalized draw scores fairly. */
  async submitGifts(userId: string, sub: z.infer<typeof GrowthService.GiftsSubmission>): Promise<GiftProfile> {
    return tx(this.pool, async (c) => {
      const dup = await maybeOne<{ assessment_id: string; scores: Record<string, number>; top_gifts: string[]; submitted_at: string; persona_summary: string | null }>(
        c,
        `SELECT assessment_id, scores, top_gifts, submitted_at, persona_summary FROM gift_assessments WHERE client_mutation_id = $1`,
        [sub.client_mutation_id],
      );
      if (dup) return { ...dup, duplicate: true };

      const set = await maybeOne<{ question_ids: string[] }>(
        c,
        `SELECT question_ids FROM gift_question_sets WHERE set_id = $1 AND user_id = $2`,
        [sub.set_id, userId],
      );
      if (!set) throw new ApiError("NOT_FOUND", "Question set not found");
      const served = await many<{ question_id: string; gift_key: string }>(
        c,
        `SELECT question_id, gift_key FROM gift_questions WHERE question_id = ANY($1)`,
        [set.question_ids],
      );
      if (served.length === 0) throw new ApiError("UNPROCESSABLE", "Question set is empty");

      const servedIds = new Set(served.map((q) => q.question_id));
      const given = new Map(sub.answers.filter((a) => servedIds.has(a.question_id)).map((a) => [a.question_id, a.value]));
      const sums = new Map<string, { got: number; max: number }>();
      for (const q of served) {
        const agg = sums.get(q.gift_key) ?? { got: 0, max: 0 };
        agg.got += given.get(q.question_id) ?? 0;
        agg.max += 5;
        sums.set(q.gift_key, agg);
      }
      const scores: Record<string, number> = {};
      for (const [gift, { got, max }] of sums) scores[gift] = Math.round((got / max) * 100);
      const top = [...sums.keys()].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b)).slice(0, 3);
      const persona = await this.composePersona(c, top, scores);

      const row = await one<{ assessment_id: string; submitted_at: string }>(
        c,
        `INSERT INTO gift_assessments (user_id, scores, top_gifts, client_mutation_id, set_id, persona_summary)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING assessment_id, submitted_at`,
        [userId, JSON.stringify(scores), top, sub.client_mutation_id, sub.set_id, persona],
      );
      for (const [qid, val] of given) {
        await c.query(`INSERT INTO gift_answers (assessment_id, question_id, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [row.assessment_id, qid, val]);
      }
      await c.query(`UPDATE gift_question_sets SET submitted_assessment_id = $1 WHERE set_id = $2`, [row.assessment_id, sub.set_id]);
      await recordChange(c, "gift_assessments", row.assessment_id, userId, "upsert");
      await recordActivityEvent(c, userId, "gift_assessment");
      return { assessment_id: row.assessment_id, scores, top_gifts: top, submitted_at: row.submitted_at, persona_summary: persona, duplicate: false };
    });
  }

  /** Latest gift profile as a personality result: top-gift personas + the
   *  personalized narrative + "where to serve" tracks. */
  async myGifts(userId: string): Promise<unknown> {
    const latest = await maybeOne<{ assessment_id: string; scores: Record<string, number>; top_gifts: string[]; submitted_at: string; persona_summary: string | null }>(
      this.pool,
      `SELECT assessment_id, scores, top_gifts, submitted_at, persona_summary FROM gift_assessments
        WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [userId],
    );
    if (!latest) return { assessment: null, personas: [], suggested_tracks: [] };
    const personaRows = await many<{ gift_key: string }>(
      this.pool,
      `SELECT gift_key, title, persona_name, tagline, summary, strengths, serving, emoji, color
         FROM gift_definitions WHERE gift_key = ANY($1)`,
      [latest.top_gifts],
    );
    const pm = new Map(personaRows.map((p) => [p.gift_key, p]));
    const personas = latest.top_gifts.map((k) => pm.get(k)).filter(Boolean);
    const tracks = await many(
      this.pool,
      `SELECT track_key, title, description, gift_keys,
              cardinality(ARRAY(SELECT unnest(gift_keys) INTERSECT SELECT unnest($1::text[])))::int AS match_count
         FROM serving_tracks
        WHERE gift_keys && $1::text[]
        ORDER BY match_count DESC, track_key`,
      [latest.top_gifts],
    );
    return { assessment: latest, personas, suggested_tracks: tracks };
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
