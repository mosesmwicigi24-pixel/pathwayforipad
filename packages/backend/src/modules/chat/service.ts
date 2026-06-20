// Chat: direct messages, cell groups, and public spaces (mobile "Chat" make).
// Membership is server-authoritative (§5.4): a member reads only conversations
// they belong to, plus public spaces in their congregation. Sends are offline-
// queueable — client-generated message_id + client_mutation_id replays are
// no-ops (§1.7/§3.6). DMs respect minor-safety (D-M6): a member cannot open a
// DM with a minor (nor a minor with anyone). Group rooms are auto-provisioned
// per cell and the caller is auto-joined on first read.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

interface ConversationRow {
  conversation_id: string;
  kind: "dm" | "group" | "space";
  is_public: boolean;
  congregation_id: string | null;
  cell_group_id: string | null;
}

/** Roles with cross-conversation oversight + moderation (§5.4). */
type ViewerRole = string | undefined;
const isModerator = (role: ViewerRole): boolean => role === "Admin" || role === "SuperAdmin";

type ModerationAction = "flag" | "unflag" | "remove" | "restore";

export class ChatService {
  constructor(private readonly pool: Pool) {}

  static readonly SendMessage = z.object({
    message_id: z.string().uuid(), // client-generated (offline-first)
    body: z.string().max(20_000).default(""),
    msg_type: z.enum(["text", "voice", "image", "file", "video"]).default("text"),
    attachment_url: z.string().url().max(2000).optional(),
    attachment_meta: z.record(z.unknown()).optional(),
    reply_to_id: z.string().uuid().optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly ToggleReaction = z.object({
    message_id: z.string().uuid(),
    emoji: z.string().min(1).max(16),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly MarkRead = z.object({
    conversation_id: z.string().uuid(),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly CreateDm = z.object({ user_id: z.string().uuid() });

  static readonly CreateSpace = z.object({
    conversation_id: z.string().uuid(),
    title: z.string().min(3).max(200),
    topic: z.string().max(300).optional(),
    category: z.string().max(24).optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  /** The caller's cell + congregation + display fields, or nulls. */
  private async me(c: Queryable, userId: string): Promise<{ cell_group_id: string | null; congregation_id: string | null; is_minor: boolean }> {
    return one(
      c,
      `SELECT cell_group_id, congregation_id, is_minor FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  }

  /**
   * Ensure a cell has its group room and return its conversation id, without the
   * write-on-read churn of the previous DO UPDATE (which bumped updated_at on
   * every inbox load). Derives congregation + title from the cell itself, so it
   * works for any cell — not just the caller's. Returns null if the cell is gone.
   */
  private async ensureGroupForCell(c: Queryable, cellGroupId: string): Promise<string | null> {
    const existing = await maybeOne<{ conversation_id: string }>(
      c,
      `SELECT conversation_id FROM chat_conversations WHERE cell_group_id = $1 AND kind = 'group'`,
      [cellGroupId],
    );
    if (existing) return existing.conversation_id;
    const cell = await maybeOne<{ name: string; congregation_id: string }>(
      c,
      `SELECT name, congregation_id FROM cell_groups WHERE cell_group_id = $1`,
      [cellGroupId],
    );
    if (!cell) return null;
    const convo = await one<{ conversation_id: string }>(
      c,
      `INSERT INTO chat_conversations (conversation_id, kind, title, cell_group_id, congregation_id, is_public)
       VALUES (gen_random_uuid(), 'group', $1, $2, $3, FALSE)
       ON CONFLICT (cell_group_id) WHERE kind = 'group' DO NOTHING
       RETURNING conversation_id`,
      [`${cell.name} cell`, cellGroupId, cell.congregation_id],
    );
    // Lost the insert race → read the row the winning transaction created.
    if (convo) return convo.conversation_id;
    const raced = await one<{ conversation_id: string }>(
      c,
      `SELECT conversation_id FROM chat_conversations WHERE cell_group_id = $1 AND kind = 'group'`,
      [cellGroupId],
    );
    return raced.conversation_id;
  }

  /** Ensure the caller's cell has a group room and the caller is a member of it.
   *  Skips all writes once both already hold — the common case on inbox reload. */
  private async ensureCellGroup(c: Queryable, userId: string): Promise<void> {
    const me = await this.me(c, userId);
    if (!me.cell_group_id) return;
    const already = await maybeOne(
      c,
      `SELECT 1 FROM chat_members m
         JOIN chat_conversations cv ON cv.conversation_id = m.conversation_id
        WHERE cv.cell_group_id = $1 AND cv.kind = 'group' AND m.user_id = $2`,
      [me.cell_group_id, userId],
    );
    if (already) return; // provisioned + joined — no write needed
    const conversationId = await this.ensureGroupForCell(c, me.cell_group_id);
    if (!conversationId) return;
    await c.query(
      `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [conversationId, userId],
    );
  }

  /**
   * Open (provisioning if needed) a specific cell's group conversation and add
   * the actor as a member so they can post — used by the portal's "Message cell"
   * action. Caller scope (leader_assignments / Admin) is enforced at the route
   * via assertCellInScope before this runs.
   */
  async ensureCellConversation(actorUserId: string, cellGroupId: string): Promise<{ conversation_id: string }> {
    return tx(this.pool, async (c) => {
      const conversationId = await this.ensureGroupForCell(c, cellGroupId);
      if (!conversationId) throw new ApiError("NOT_FOUND", "Cell not found");
      await c.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [conversationId, actorUserId],
      );
      return { conversation_id: conversationId };
    });
  }

  /**
   * DM directory: members in the caller's congregation the caller may message.
   * Minor-safe (D-M6) — a minor caller gets an empty list, and minors never
   * appear for anyone. Excludes self and soft-deleted users. Optional name search.
   */
  async listPeople(userId: string, q?: string): Promise<{ people: unknown[] }> {
    const me = await this.me(this.pool, userId);
    // A caller with no congregation sees nobody (can't be scoped to a directory).
    if (me.is_minor || !me.congregation_id) return { people: [] };
    const term = (q ?? "").trim();
    const people = await many(
      this.pool,
      // Only real congregation members appear: a user with a NULL congregation
      // (e.g. an unattached signup) is never DM-able. `= $1` already excludes
      // NULLs; the explicit IS NOT NULL locks the guarantee.
      `SELECT u.user_id, u.full_name, u.role
         FROM users u
        WHERE u.congregation_id = $1
          AND u.congregation_id IS NOT NULL
          AND u.user_id <> $2
          AND u.deleted_at IS NULL
          AND u.is_minor = FALSE
          ${term ? "AND u.full_name ILIKE $3" : ""}
        ORDER BY u.full_name
        LIMIT 100`,
      term ? [me.congregation_id, userId, `%${term}%`] : [me.congregation_id, userId],
    );
    return { people };
  }

  /** Membership-checked conversation fetch; public spaces are readable by congregation members. */
  private async access(c: Queryable, userId: string, conversationId: string): Promise<ConversationRow> {
    const convo = await maybeOne<ConversationRow>(
      c,
      `SELECT conversation_id, kind, is_public, congregation_id, cell_group_id
         FROM chat_conversations WHERE conversation_id = $1`,
      [conversationId],
    );
    if (!convo) throw new ApiError("NOT_FOUND", "Conversation not found");
    const member = await maybeOne(c, `SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
    if (member) return convo;
    const me = await this.me(c, userId);
    // A cell's group room belongs to every member of that cell — auto-join on access.
    if (convo.kind === "group" && convo.cell_group_id && me.cell_group_id === convo.cell_group_id) {
      await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      return convo;
    }
    if (convo.kind === "space" && convo.is_public && me.congregation_id && me.congregation_id === convo.congregation_id) {
      return convo; // readable, not yet joined
    }
    throw new ApiError("NOT_FOUND", "Conversation not found"); // no existence leak
  }

  /** Moderator conversation fetch — bypasses membership (Admin/SuperAdmin only). */
  private async accessAsModerator(c: Queryable, conversationId: string): Promise<ConversationRow> {
    const convo = await maybeOne<ConversationRow>(
      c,
      `SELECT conversation_id, kind, is_public, congregation_id, cell_group_id
         FROM chat_conversations WHERE conversation_id = $1`,
      [conversationId],
    );
    if (!convo) throw new ApiError("NOT_FOUND", "Conversation not found");
    return convo;
  }

  /**
   * Admin/SuperAdmin oversight inbox: every conversation, with member count,
   * last-message preview, and a per-conversation count of flagged-but-not-hidden
   * messages. Server-authoritative (§1.1) — only moderators reach this path.
   */
  private async listAllForModeration(): Promise<{ conversations: unknown[]; discover_spaces: unknown[] }> {
    const conversations = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public,
              cv.title, cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              lm.body AS last_body, lm.msg_type AS last_type, lm.created_at AS last_at,
              la.full_name AS last_author,
              0 AS unread,
              (SELECT count(*)::int FROM chat_messages fm
                 WHERE fm.conversation_id = cv.conversation_id AND fm.is_flagged AND NOT fm.is_hidden) AS flagged
         FROM chat_conversations cv
         LEFT JOIN LATERAL (
            SELECT body, msg_type, created_at, author_user_id FROM chat_messages
             WHERE conversation_id = cv.conversation_id AND NOT is_hidden
             ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
         LEFT JOIN users la ON la.user_id = lm.author_user_id
        ORDER BY COALESCE(lm.created_at, cv.created_at) DESC
        LIMIT 500`,
      [],
    );
    return { conversations, discover_spaces: [] };
  }

  /** The inbox: my conversations (with unread + preview) + discoverable spaces. */
  async listConversations(userId: string, viewerRole?: ViewerRole): Promise<{ conversations: unknown[]; discover_spaces: unknown[] }> {
    if (isModerator(viewerRole)) return this.listAllForModeration();
    await tx(this.pool, async (c) => this.ensureCellGroup(c, userId));
    const conversations = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public,
              CASE WHEN cv.kind = 'dm' THEN other.full_name ELSE cv.title END AS title,
              cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              lm.body AS last_body, lm.msg_type AS last_type, lm.created_at AS last_at,
              la.full_name AS last_author,
              (SELECT count(*)::int FROM chat_messages um
                 WHERE um.conversation_id = cv.conversation_id AND NOT um.is_hidden
                   AND um.author_user_id <> $1
                   AND (mem.last_read_at IS NULL OR um.created_at > mem.last_read_at)) AS unread
         FROM chat_members mem
         JOIN chat_conversations cv ON cv.conversation_id = mem.conversation_id
         LEFT JOIN LATERAL (
            SELECT om.user_id FROM chat_members om
             WHERE om.conversation_id = cv.conversation_id AND om.user_id <> $1 LIMIT 1
         ) od ON cv.kind = 'dm'
         LEFT JOIN users other ON other.user_id = od.user_id
         LEFT JOIN LATERAL (
            SELECT body, msg_type, created_at, author_user_id FROM chat_messages
             WHERE conversation_id = cv.conversation_id AND NOT is_hidden
             ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
         LEFT JOIN users la ON la.user_id = lm.author_user_id
        WHERE mem.user_id = $1
        ORDER BY COALESCE(lm.created_at, cv.created_at) DESC
        LIMIT 200`,
      [userId],
    );
    const discover = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.title, cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count
         FROM chat_conversations cv
         JOIN users u ON u.user_id = $1
        WHERE cv.kind = 'space' AND cv.is_public = TRUE
          AND cv.congregation_id = u.congregation_id
          AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = cv.conversation_id AND m.user_id = $1)
        ORDER BY cv.created_at DESC
        LIMIT 50`,
      [userId],
    );
    return { conversations, discover_spaces: discover };
  }

  /**
   * A conversation's messages (oldest→newest) with reactions, reply previews,
   * authors. Members see only visible messages. Moderators (Admin/SuperAdmin)
   * bypass membership, see hidden messages, and get per-message moderation state.
   */
  async getConversation(userId: string, conversationId: string, viewerRole?: ViewerRole): Promise<unknown> {
    const moderator = isModerator(viewerRole);
    const convo = moderator
      ? await this.accessAsModerator(this.pool, conversationId)
      : await this.access(this.pool, userId, conversationId);
    const head = await one<Record<string, unknown>>(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public, cv.topic, cv.category,
              CASE WHEN cv.kind = 'dm' THEN other.full_name ELSE cv.title END AS title,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = cv.conversation_id AND m.user_id = $1) AS joined
         FROM chat_conversations cv
         LEFT JOIN LATERAL (
            SELECT om.user_id FROM chat_members om WHERE om.conversation_id = cv.conversation_id AND om.user_id <> $1 LIMIT 1
         ) od ON cv.kind = 'dm'
         LEFT JOIN users other ON other.user_id = od.user_id
        WHERE cv.conversation_id = $2`,
      [userId, conversationId],
    );
    const messages = await many(
      this.pool,
      `SELECT m.message_id, m.author_user_id, u.full_name AS author_name, m.body, m.msg_type,
              m.attachment_url, m.attachment_meta, m.reply_to_id, m.ai_tag, m.is_edited, m.created_at,
              ${moderator ? "m.is_hidden, m.is_flagged, m.flag_reason, m.moderated_at," : ""}
              rt.body AS reply_body, ru.full_name AS reply_author,
              (m.author_user_id = $1) AS mine,
              COALESCE((
                 SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'mine', r.mine))
                   FROM (SELECT emoji, count(*)::int AS cnt, bool_or(user_id = $1) AS mine
                           FROM chat_reactions WHERE message_id = m.message_id GROUP BY emoji) r
              ), '[]'::json) AS reactions
         FROM chat_messages m
         JOIN users u ON u.user_id = m.author_user_id
         LEFT JOIN chat_messages rt ON rt.message_id = m.reply_to_id
         LEFT JOIN users ru ON ru.user_id = rt.author_user_id
        WHERE m.conversation_id = $2 ${moderator ? "" : "AND NOT m.is_hidden"}
        ORDER BY m.created_at
        LIMIT 500`,
      [userId, conversationId],
    );
    return { ...head, kind: convo.kind, messages };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    input: z.infer<typeof ChatService.SendMessage>,
  ): Promise<{ message_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ message_id: string }>(c, `SELECT message_id FROM chat_messages WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { message_id: dup.message_id, duplicate: true };
      }
      const convo = await this.access(c, userId, conversationId);
      // Public spaces auto-join the sender on first post (matches the make's join-then-send flow).
      if (convo.kind === "space") {
        await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      }
      const res = await c.query(
        `INSERT INTO chat_messages (message_id, conversation_id, author_user_id, body, msg_type, attachment_url, attachment_meta, reply_to_id, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
        [
          input.message_id, conversationId, userId, input.body, input.msg_type,
          input.attachment_url ?? null, input.attachment_meta ? JSON.stringify(input.attachment_meta) : null,
          input.reply_to_id ?? null, input.client_mutation_id ?? null,
        ],
      );
      if (res.rowCount === 0) return { message_id: input.message_id, duplicate: true };
      await c.query(`UPDATE chat_conversations SET updated_at = now() WHERE conversation_id = $1`, [conversationId]);
      await recordChange(c, "chat_messages", input.message_id, null, "upsert");
      return { message_id: input.message_id, duplicate: false };
    });
  }

  async toggleReaction(userId: string, input: z.infer<typeof ChatService.ToggleReaction>): Promise<{ message_id: string; emoji: string; on: boolean }> {
    return tx(this.pool, async (c) => {
      const msg = await maybeOne<{ conversation_id: string }>(c, `SELECT conversation_id FROM chat_messages WHERE message_id = $1 AND NOT is_hidden`, [input.message_id]);
      if (!msg) throw new ApiError("NOT_FOUND", "Message not found");
      await this.access(c, userId, msg.conversation_id);
      const del = await c.query(`DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, [input.message_id, userId, input.emoji]);
      if ((del.rowCount ?? 0) > 0) return { message_id: input.message_id, emoji: input.emoji, on: false };
      await c.query(`INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [input.message_id, userId, input.emoji]);
      return { message_id: input.message_id, emoji: input.emoji, on: true };
    });
  }

  async markRead(userId: string, conversationId: string): Promise<{ conversation_id: string }> {
    await this.access(this.pool, userId, conversationId);
    await this.pool.query(
      `UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    return { conversation_id: conversationId };
  }

  /** Create or return the 1:1 DM with another member (minor-safe, same congregation). */
  async createOrGetDm(userId: string, otherUserId: string): Promise<{ conversation_id: string }> {
    if (otherUserId === userId) throw new ApiError("UNPROCESSABLE", "Cannot DM yourself");
    return tx(this.pool, async (c) => {
      const me = await this.me(c, userId);
      const other = await maybeOne<{ congregation_id: string | null; is_minor: boolean }>(
        c, `SELECT congregation_id, is_minor FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [otherUserId],
      );
      if (!other) throw new ApiError("NOT_FOUND", "Member not found");
      if (me.is_minor || other.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Direct messages are unavailable for minors");
      if (!me.congregation_id || me.congregation_id !== other.congregation_id) throw new ApiError("NOT_FOUND", "Member not found");

      const existing = await maybeOne<{ conversation_id: string }>(
        c,
        `SELECT cv.conversation_id FROM chat_conversations cv
          WHERE cv.kind = 'dm'
            AND EXISTS (SELECT 1 FROM chat_members a WHERE a.conversation_id = cv.conversation_id AND a.user_id = $1)
            AND EXISTS (SELECT 1 FROM chat_members b WHERE b.conversation_id = cv.conversation_id AND b.user_id = $2)
          LIMIT 1`,
        [userId, otherUserId],
      );
      if (existing) return { conversation_id: existing.conversation_id };

      const convo = await one<{ conversation_id: string }>(
        c,
        `INSERT INTO chat_conversations (conversation_id, kind, congregation_id, created_by)
         VALUES (gen_random_uuid(), 'dm', $1, $2) RETURNING conversation_id`,
        [me.congregation_id, userId],
      );
      await c.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
        [convo.conversation_id, userId, otherUserId],
      );
      return { conversation_id: convo.conversation_id };
    });
  }

  /** Join a public space in the caller's congregation. */
  async joinSpace(userId: string, conversationId: string): Promise<{ conversation_id: string; joined: boolean }> {
    return tx(this.pool, async (c) => {
      const convo = await this.access(c, userId, conversationId);
      if (convo.kind !== "space") throw new ApiError("UNPROCESSABLE", "Not a space");
      await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      return { conversation_id: conversationId, joined: true };
    });
  }

  /** Create a public space in the caller's congregation (Instructor+). */
  async createSpace(userId: string, input: z.infer<typeof ChatService.CreateSpace>): Promise<{ conversation_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ conversation_id: string }>(c, `SELECT conversation_id FROM chat_conversations WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { conversation_id: dup.conversation_id, duplicate: true };
      }
      const me = await this.me(c, userId);
      const res = await c.query(
        `INSERT INTO chat_conversations (conversation_id, kind, title, topic, category, congregation_id, is_public, created_by, client_mutation_id)
         VALUES ($1, 'space', $2, $3, $4, $5, TRUE, $6, $7) ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id`,
        [input.conversation_id, input.title, input.topic ?? null, input.category ?? null, me.congregation_id, userId, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { conversation_id: input.conversation_id, duplicate: true };
      await c.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`, [input.conversation_id, userId]);
      return { conversation_id: input.conversation_id, duplicate: false };
    });
  }

  /**
   * Moderate a message (Admin/SuperAdmin only, §5.4). Server-authoritative state
   * (§1.1): flag (soft, still visible to members), unflag, remove (hide from
   * members), restore. Stamps moderated_by/at for the audit trail.
   */
  async moderateMessage(
    actorId: string,
    role: ViewerRole,
    messageId: string,
    action: ModerationAction,
    reason?: string,
  ): Promise<{ message_id: string; is_flagged: boolean; is_hidden: boolean }> {
    if (!isModerator(role)) throw new ApiError("FORBIDDEN_SCOPE", "Moderation requires Admin");
    return tx(this.pool, async (c) => {
      const msg = await maybeOne<{ message_id: string }>(c, `SELECT message_id FROM chat_messages WHERE message_id = $1`, [messageId]);
      if (!msg) throw new ApiError("NOT_FOUND", "Message not found");
      let row: { is_flagged: boolean; is_hidden: boolean };
      switch (action) {
        case "flag":
          row = await one(c, `UPDATE chat_messages SET is_flagged = TRUE, flag_reason = $2, moderated_by = $3, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, reason ?? null, actorId]);
          break;
        case "unflag":
          row = await one(c, `UPDATE chat_messages SET is_flagged = FALSE, flag_reason = NULL, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
        case "remove":
          row = await one(c, `UPDATE chat_messages SET is_hidden = TRUE, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
        case "restore":
          row = await one(c, `UPDATE chat_messages SET is_hidden = FALSE, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
      }
      return { message_id: messageId, is_flagged: row.is_flagged, is_hidden: row.is_hidden };
    });
  }
}
