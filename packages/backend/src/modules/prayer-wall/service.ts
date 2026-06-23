// Prayer Wall (public, congregation-scoped). A member opts a request into the
// public wall (or shares one from their private journal); others pray under it
// with emoji reactions (🙏 = "I'm praying") and comments. Server-authoritative
// scope (§5.4): you only see your congregation's wall. Idempotent, offline-safe
// writes (client-generated ids + client_mutation_id).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const PRAY = "🙏";

export class PrayerWallService {
  constructor(private readonly pool: Pool) {}

  // Normalized peak amplitudes (0–100), ~40 bars, captured from the mic meter.
  private static readonly Waveform = z.array(z.number().int().min(0).max(100)).max(80).nullable().optional();
  static readonly Post = z.object({
    post_id: z.string().uuid(),
    title: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(4000),
    audio_url: z.string().url().max(500).nullable().optional(),
    audio_waveform: PrayerWallService.Waveform,
    client_mutation_id: z.string().uuid().optional(),
  });
  static readonly Comment = z.object({
    comment_id: z.string().uuid(),
    body: z.string().min(1).max(2000),
    audio_url: z.string().url().max(500).nullable().optional(),
    audio_waveform: PrayerWallService.Waveform,
    client_mutation_id: z.string().uuid().optional(),
  });
  static readonly Reaction = z.object({ emoji: z.string().min(1).max(16) });

  private async congregationOf(c: Queryable, userId: string): Promise<string | null> {
    const u = await maybeOne<{ congregation_id: string | null }>(c, `SELECT congregation_id FROM users WHERE user_id = $1`, [userId]);
    return u?.congregation_id ?? null;
  }

  /** The wall feed for my congregation, with author, reaction summary, pray + comment counts. */
  async list(userId: string, sort: "latest" | "prayed" = "latest"): Promise<{ data: unknown[] }> {
    const order = sort === "prayed" ? "pray_count DESC, p.created_at DESC" : "p.created_at DESC";
    const data = await many(
      this.pool,
      `SELECT p.post_id, p.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              p.title, p.body, p.audio_url, p.audio_waveform, p.is_answered, p.created_at,
              (p.author_user_id = $1) AS mine,
              COALESCE((SELECT count(*)::int FROM prayer_wall_reactions r WHERE r.post_id = p.post_id AND r.emoji = '${PRAY}'), 0) AS pray_count,
              COALESCE((SELECT bool_or(r.user_id = $1) FROM prayer_wall_reactions r WHERE r.post_id = p.post_id AND r.emoji = '${PRAY}'), false) AS i_prayed,
              (SELECT count(*)::int FROM prayer_wall_comments cm WHERE cm.post_id = p.post_id AND NOT cm.is_hidden) AS comment_count,
              COALESCE((
                SELECT json_agg(json_build_object('emoji', x.emoji, 'count', x.cnt, 'mine', x.mine) ORDER BY x.cnt DESC)
                  FROM (SELECT emoji, count(*)::int AS cnt, bool_or(user_id = $1) AS mine
                          FROM prayer_wall_reactions WHERE post_id = p.post_id GROUP BY emoji) x
              ), '[]'::json) AS reactions
         FROM prayer_wall_posts p
         JOIN users u ON u.user_id = p.author_user_id
        WHERE NOT p.is_hidden
          AND p.congregation_id = (SELECT congregation_id FROM users WHERE user_id = $1)
        ORDER BY ${order}
        LIMIT 100`,
      [userId],
    );
    return { data };
  }

  /** A small set for the Home carousel — most-prayed recent requests. */
  async home(userId: string): Promise<{ data: unknown[] }> {
    const { data } = await this.list(userId, "prayed");
    return { data: (data as Array<{ created_at: string }>).slice(0, 10) };
  }

  async create(userId: string, input: z.infer<typeof PrayerWallService.Post>): Promise<{ post_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ post_id: string }>(c, `SELECT post_id FROM prayer_wall_posts WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { post_id: dup.post_id, duplicate: true };
      }
      const cong = await this.congregationOf(c, userId);
      const res = await c.query(
        `INSERT INTO prayer_wall_posts (post_id, author_user_id, congregation_id, title, body, audio_url, audio_waveform, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (post_id) DO NOTHING RETURNING post_id`,
        [input.post_id, userId, cong, input.title ?? null, input.body, input.audio_url ?? null, input.audio_waveform ? JSON.stringify(input.audio_waveform) : null, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { post_id: input.post_id, duplicate: true };
      return { post_id: input.post_id, duplicate: false };
    });
  }

  /** Share a private journal entry to the public wall (creates a wall post from it). */
  async shareFromJournal(userId: string, entryId: string): Promise<{ post_id: string }> {
    return tx(this.pool, async (c) => {
      const entry = await maybeOne<{ title: string | null; body: string }>(
        c,
        `SELECT title, body FROM prayer_entries WHERE entry_id = $1 AND user_id = $2`,
        [entryId, userId],
      );
      if (!entry) throw new ApiError("NOT_FOUND", "Prayer not found");
      const existing = await maybeOne<{ post_id: string }>(c, `SELECT post_id FROM prayer_wall_posts WHERE source_entry_id = $1 AND author_user_id = $2`, [entryId, userId]);
      if (existing) return { post_id: existing.post_id };
      const cong = await this.congregationOf(c, userId);
      const row = await one<{ post_id: string }>(
        c,
        `INSERT INTO prayer_wall_posts (post_id, author_user_id, congregation_id, title, body, source_entry_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING post_id`,
        [userId, cong, entry.title, entry.body, entryId],
      );
      return { post_id: row.post_id };
    });
  }

  /** Full post + its comments (author + avatars), scoped to my congregation. */
  async get(userId: string, postId: string): Promise<unknown> {
    const post = await maybeOne(
      this.pool,
      `SELECT p.post_id, p.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              p.title, p.body, p.audio_url, p.audio_waveform, p.is_answered, p.created_at,
              (p.author_user_id = $1) AS mine,
              COALESCE((SELECT count(*)::int FROM prayer_wall_reactions r WHERE r.post_id = p.post_id AND r.emoji = '${PRAY}'), 0) AS pray_count,
              COALESCE((SELECT bool_or(r.user_id = $1) FROM prayer_wall_reactions r WHERE r.post_id = p.post_id AND r.emoji = '${PRAY}'), false) AS i_prayed,
              COALESCE((
                SELECT json_agg(json_build_object('emoji', x.emoji, 'count', x.cnt, 'mine', x.mine) ORDER BY x.cnt DESC)
                  FROM (SELECT emoji, count(*)::int AS cnt, bool_or(user_id = $1) AS mine
                          FROM prayer_wall_reactions WHERE post_id = p.post_id GROUP BY emoji) x
              ), '[]'::json) AS reactions
         FROM prayer_wall_posts p
         JOIN users u ON u.user_id = p.author_user_id
        WHERE p.post_id = $2 AND NOT p.is_hidden
          AND p.congregation_id = (SELECT congregation_id FROM users WHERE user_id = $1)`,
      [userId, postId],
    );
    if (!post) throw new ApiError("NOT_FOUND", "Prayer not found");
    const comments = await many(
      this.pool,
      `SELECT cm.comment_id, cm.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              cm.body, cm.audio_url, cm.audio_waveform, cm.created_at, (cm.author_user_id = $1) AS mine
         FROM prayer_wall_comments cm
         JOIN users u ON u.user_id = cm.author_user_id
        WHERE cm.post_id = $2 AND NOT cm.is_hidden
        ORDER BY cm.created_at`,
      [userId, postId],
    );
    return { post, comments };
  }

  /** Ensure the post is on my congregation's wall (visibility check). */
  private async access(c: Queryable, userId: string, postId: string): Promise<void> {
    const ok = await maybeOne(
      c,
      `SELECT 1 FROM prayer_wall_posts p
        WHERE p.post_id = $2 AND NOT p.is_hidden
          AND p.congregation_id = (SELECT congregation_id FROM users WHERE user_id = $1)`,
      [userId, postId],
    );
    if (!ok) throw new ApiError("NOT_FOUND", "Prayer not found");
  }

  async toggleReaction(userId: string, postId: string, emoji: string): Promise<{ on: boolean }> {
    return tx(this.pool, async (c) => {
      await this.access(c, userId, postId);
      const del = await c.query(`DELETE FROM prayer_wall_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3`, [postId, userId, emoji]);
      if ((del.rowCount ?? 0) > 0) return { on: false };
      await c.query(`INSERT INTO prayer_wall_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [postId, userId, emoji]);
      return { on: true };
    });
  }

  async comment(userId: string, postId: string, input: z.infer<typeof PrayerWallService.Comment>): Promise<{ comment_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      await this.access(c, userId, postId);
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ comment_id: string }>(c, `SELECT comment_id FROM prayer_wall_comments WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { comment_id: dup.comment_id, duplicate: true };
      }
      const res = await c.query(
        `INSERT INTO prayer_wall_comments (comment_id, post_id, author_user_id, body, audio_url, audio_waveform, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (comment_id) DO NOTHING RETURNING comment_id`,
        [input.comment_id, postId, userId, input.body, input.audio_url ?? null, input.audio_waveform ? JSON.stringify(input.audio_waveform) : null, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { comment_id: input.comment_id, duplicate: true };
      return { comment_id: input.comment_id, duplicate: false };
    });
  }

  /** Author marks their request answered (a testimony for the wall). */
  async setAnswered(userId: string, postId: string, answered: boolean): Promise<{ is_answered: boolean }> {
    const row = await maybeOne<{ is_answered: boolean }>(
      this.pool,
      `UPDATE prayer_wall_posts SET is_answered = $3, updated_at = now()
         WHERE post_id = $1 AND author_user_id = $2 RETURNING is_answered`,
      [postId, userId, answered],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Prayer not found or not yours");
    return { is_answered: row.is_answered };
  }

  /** Author makes their request private again (removes it from the wall). */
  async remove(userId: string, postId: string): Promise<{ deleted: boolean }> {
    const row = await maybeOne<{ post_id: string }>(
      this.pool,
      `DELETE FROM prayer_wall_posts WHERE post_id = $1 AND author_user_id = $2 RETURNING post_id`,
      [postId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Prayer not found or not yours");
    return { deleted: true };
  }
}
