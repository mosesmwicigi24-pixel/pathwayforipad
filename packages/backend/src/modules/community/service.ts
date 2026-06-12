// Community: cohort discussions (Contract Matrix B8). Cell-scoped threads +
// comments — a member sees ONLY their own cell's board; leaders moderate
// (pin/lock/hide) within their leader_assignments scope (§5.4). Posts are
// offline-queueable: client-generated ids + client_mutation_id replays are
// no-ops (§1.7/§3.6). Hiding is moderation, not deletion: hidden rows stay for
// the audit trail but leave members' devices via sync tombstones.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, recordChange, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";

export class CommunityService {
  constructor(private readonly pool: Pool) {}

  static readonly CreateThread = z.object({
    thread_id: z.string().uuid(), // client-generated (offline-first)
    title: z.string().min(3).max(200),
    body: z.string().min(1).max(20_000),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly CreateComment = z.object({
    comment_id: z.string().uuid(),
    body: z.string().min(1).max(10_000),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly Moderate = z
    .object({
      pinned: z.boolean().optional(),
      locked: z.boolean().optional(),
      hidden: z.boolean().optional(),
    })
    .refine((m) => m.pinned !== undefined || m.locked !== undefined || m.hidden !== undefined, {
      message: "Nothing to change",
    });

  /** The caller's cell, or 422 — community is cell-scoped by design. */
  private async myCell(c: Queryable, userId: string): Promise<string> {
    const row = await one<{ cell_group_id: string | null }>(
      c,
      `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row.cell_group_id) {
      throw new ApiError("UNPROCESSABLE", "Join a cell group to use Community");
    }
    return row.cell_group_id;
  }

  /** My cell's board: pinned first, then newest; hidden rows excluded. */
  async listThreads(userId: string): Promise<{ data: unknown[] }> {
    const cell = await this.myCell(this.pool, userId);
    const data = await many(
      this.pool,
      `SELECT t.thread_id, t.title, t.body, t.is_pinned, t.is_locked, t.created_at,
              u.full_name AS author_name, t.author_user_id,
              (SELECT count(*)::int FROM discussion_comments c
                WHERE c.thread_id = t.thread_id AND NOT c.is_hidden) AS comment_count
         FROM discussion_threads t JOIN users u ON u.user_id = t.author_user_id
        WHERE t.cell_group_id = $1 AND NOT t.is_hidden
        ORDER BY t.is_pinned DESC, t.created_at DESC
        LIMIT 100`,
      [cell],
    );
    return { data };
  }

  async createThread(
    userId: string,
    input: z.infer<typeof CommunityService.CreateThread>,
  ): Promise<{ thread_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ thread_id: string }>(
          c,
          `SELECT thread_id FROM discussion_threads WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { thread_id: dup.thread_id, duplicate: true };
      }
      const cell = await this.myCell(c, userId);
      const res = await c.query(
        `INSERT INTO discussion_threads (thread_id, cell_group_id, author_user_id, title, body, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (thread_id) DO NOTHING RETURNING thread_id`,
        [input.thread_id, cell, userId, input.title, input.body, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { thread_id: input.thread_id, duplicate: true }; // replayed id
      await recordChange(c, "discussion_threads", input.thread_id, null, "upsert"); // cell-visible, not per-user
      return { thread_id: input.thread_id, duplicate: false };
    });
  }

  /** Thread + visible comments; 404 outside the caller's cell (no existence leak). */
  async getThread(userId: string, threadId: string): Promise<unknown> {
    const cell = await this.myCell(this.pool, userId);
    const thread = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT t.thread_id, t.title, t.body, t.is_pinned, t.is_locked, t.created_at,
              t.author_user_id, u.full_name AS author_name
         FROM discussion_threads t JOIN users u ON u.user_id = t.author_user_id
        WHERE t.thread_id = $1 AND t.cell_group_id = $2 AND NOT t.is_hidden`,
      [threadId, cell],
    );
    if (!thread) throw new ApiError("NOT_FOUND", "Thread not found");
    const comments = await many(
      this.pool,
      `SELECT c.comment_id, c.body, c.created_at, c.author_user_id, u.full_name AS author_name
         FROM discussion_comments c JOIN users u ON u.user_id = c.author_user_id
        WHERE c.thread_id = $1 AND NOT c.is_hidden
        ORDER BY c.created_at
        LIMIT 500`,
      [threadId],
    );
    return { ...thread, comments };
  }

  async addComment(
    userId: string,
    threadId: string,
    input: z.infer<typeof CommunityService.CreateComment>,
  ): Promise<{ comment_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ comment_id: string }>(
          c,
          `SELECT comment_id FROM discussion_comments WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { comment_id: dup.comment_id, duplicate: true };
      }
      const cell = await this.myCell(c, userId);
      const thread = await maybeOne<{ cell_group_id: string; is_locked: boolean; is_hidden: boolean }>(
        c,
        `SELECT cell_group_id, is_locked, is_hidden FROM discussion_threads WHERE thread_id = $1 FOR UPDATE`,
        [threadId],
      );
      if (!thread || thread.is_hidden || thread.cell_group_id !== cell) {
        throw new ApiError("NOT_FOUND", "Thread not found");
      }
      if (thread.is_locked) throw new ApiError("UNPROCESSABLE", "Thread is locked");
      const res = await c.query(
        `INSERT INTO discussion_comments (comment_id, thread_id, cell_group_id, author_user_id, body, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (comment_id) DO NOTHING RETURNING comment_id`,
        [input.comment_id, threadId, cell, userId, input.body, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { comment_id: input.comment_id, duplicate: true };
      await recordChange(c, "discussion_comments", input.comment_id, null, "upsert");
      return { comment_id: input.comment_id, duplicate: false };
    });
  }

  // ---- Leader moderation (Instructor+ within leader_assignments, §5.4) ----

  async moderateThread(
    principal: Principal,
    threadId: string,
    input: z.infer<typeof CommunityService.Moderate>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const thread = await maybeOne<{ cell_group_id: string }>(
        c,
        `SELECT cell_group_id FROM discussion_threads WHERE thread_id = $1 FOR UPDATE`,
        [threadId],
      );
      if (!thread) throw new ApiError("NOT_FOUND", "Thread not found");
      await assertCellInScope(c, principal, thread.cell_group_id);

      const row = await one<Record<string, unknown>>(
        c,
        `UPDATE discussion_threads SET
           is_pinned = COALESCE($2, is_pinned),
           is_locked = COALESCE($3, is_locked),
           is_hidden = COALESCE($4, is_hidden),
           hidden_by = CASE WHEN $4 IS TRUE THEN $5::uuid WHEN $4 IS FALSE THEN NULL ELSE hidden_by END,
           updated_at = now()
         WHERE thread_id = $1
         RETURNING thread_id, is_pinned, is_locked, is_hidden`,
        [threadId, input.pinned ?? null, input.locked ?? null, input.hidden ?? null, principal.userId],
      );
      // Hide pulls it off devices (tombstone); unhide/pin/lock re-syncs it.
      await recordChange(c, "discussion_threads", threadId, null, input.hidden === true ? "delete" : "upsert");
      await audit(c, principal.userId, "community.thread_moderated", "discussion_threads", threadId, { ...input });
      return row;
    });
  }

  async hideComment(principal: Principal, commentId: string): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const comment = await maybeOne<{ cell_group_id: string; is_hidden: boolean }>(
        c,
        `SELECT cell_group_id, is_hidden FROM discussion_comments WHERE comment_id = $1 FOR UPDATE`,
        [commentId],
      );
      if (!comment) throw new ApiError("NOT_FOUND", "Comment not found");
      await assertCellInScope(c, principal, comment.cell_group_id);
      await c.query(
        `UPDATE discussion_comments SET is_hidden = TRUE, hidden_by = $2 WHERE comment_id = $1`,
        [commentId, principal.userId],
      );
      await recordChange(c, "discussion_comments", commentId, null, "delete"); // off devices
      await audit(c, principal.userId, "community.comment_hidden", "discussion_comments", commentId, {});
      return { comment_id: commentId, is_hidden: true };
    });
  }
}
