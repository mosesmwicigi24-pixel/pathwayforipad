// Announcements (Contract Matrix B5). Admin composes once; fan-out is
// per-recipient-per-channel. Push/email ride the notifications infra so quiet
// hours and the daily cap still apply (§1.5); SMS/WhatsApp go through the
// MessageProvider abstraction (faked in tests); 'banner' is in-app, served to
// members online via GET /me/announcements. Deliveries are UNIQUE per
// (announcement, user, channel), so a re-send after a crash is a no-op.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { NotificationService } from "../notifications/service.js";
import { FakeMessageProvider, type MessageProvider } from "./providers.js";

const CHANNELS = ["push", "email", "sms", "whatsapp", "banner"] as const;
type Channel = (typeof CHANNELS)[number];

export interface AnnouncementRow {
  announcement_id: string;
  title: string;
  body: string;
  channels: Channel[];
  audience_kind: "all" | "cells" | "level";
  audience_cells: string[] | null;
  audience_level: number | null;
  status: "draft" | "scheduled" | "sent" | "cancelled";
  scheduled_at: string | null;
  sent_at: string | null;
  banner_expires_at: string | null;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  is_featured: boolean;
  created_by: string;
  created_at: string;
}

const SELECT_COLS = `announcement_id, title, body, channels, audience_kind, audience_cells,
  audience_level, status, scheduled_at, sent_at, banner_expires_at,
  primary_image_url, gallery_image_urls, is_featured, created_by, created_at`;

export class AnnouncementService {
  private readonly notifications: NotificationService;
  private readonly providers: Record<"sms" | "whatsapp", MessageProvider>;

  constructor(
    private readonly pool: Pool,
    deps?: {
      notifications?: NotificationService;
      sms?: MessageProvider;
      whatsapp?: MessageProvider;
    },
  ) {
    this.notifications = deps?.notifications ?? new NotificationService(pool);
    this.providers = {
      sms: deps?.sms ?? new FakeMessageProvider("sms"),
      whatsapp: deps?.whatsapp ?? new FakeMessageProvider("whatsapp"),
    };
  }

  static readonly Compose = z
    .object({
      title: z.string().min(3).max(200),
      body: z.string().min(1).max(20_000), // Markdown
      channels: z.array(z.enum(CHANNELS)).min(1),
      audience: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("all") }),
        z.object({ kind: z.literal("cells"), cell_group_ids: z.array(z.string().uuid()).min(1) }),
        z.object({ kind: z.literal("level"), level_number: z.number().int().min(1) }),
      ]),
      scheduled_at: z.string().datetime().optional(), // omit = stays a draft until /send
      banner_expires_at: z.string().datetime().optional(),
      // Optional cover image + a small gallery (up to 5 extra → 6 total) shown as a
      // carousel on the mobile announcement detail.
      primary_image_url: z.string().url().max(2048).nullable().optional(),
      gallery_image_urls: z.array(z.string().url().max(2048)).max(5).optional(),
    })
    .strict();

  static readonly List = z.object({
    status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  async create(
    adminId: string,
    input: z.infer<typeof AnnouncementService.Compose>,
  ): Promise<AnnouncementRow> {
    const a = input.audience;
    const status = input.scheduled_at ? "scheduled" : "draft";
    const row = await one<AnnouncementRow>(
      this.pool,
      `INSERT INTO announcements
         (title, body, channels, audience_kind, audience_cells, audience_level,
          status, scheduled_at, banner_expires_at, created_by, primary_image_url, gallery_image_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLS}`,
      [
        input.title,
        input.body,
        input.channels,
        a.kind,
        a.kind === "cells" ? a.cell_group_ids : null,
        a.kind === "level" ? a.level_number : null,
        status,
        input.scheduled_at ?? null,
        input.banner_expires_at ?? null,
        adminId,
        input.primary_image_url ?? null,
        input.gallery_image_urls ?? [],
      ],
    );
    await audit(this.pool, adminId, "announcement.created", "announcements", row.announcement_id, {
      status,
      channels: input.channels,
      audience: a.kind,
    });
    return row;
  }

  async update(
    adminId: string,
    id: string,
    input: z.infer<typeof AnnouncementService.Compose>,
  ): Promise<AnnouncementRow> {
    const a = input.audience;
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `UPDATE announcements
          SET title=$2, body=$3, channels=$4, audience_kind=$5, audience_cells=$6,
              audience_level=$7, scheduled_at=$8, banner_expires_at=$9,
              primary_image_url=$10, gallery_image_urls=$11,
              status = CASE WHEN $8::timestamptz IS NULL THEN 'draft' ELSE 'scheduled' END,
              updated_at = now()
        WHERE announcement_id = $1 AND status IN ('draft','scheduled') AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [
        id,
        input.title,
        input.body,
        input.channels,
        a.kind,
        a.kind === "cells" ? a.cell_group_ids : null,
        a.kind === "level" ? a.level_number : null,
        input.scheduled_at ?? null,
        input.banner_expires_at ?? null,
        input.primary_image_url ?? null,
        input.gallery_image_urls ?? [],
      ],
    );
    if (!row) throw new ApiError("CONFLICT", "Only draft or scheduled announcements can be edited");
    await audit(this.pool, adminId, "announcement.updated", "announcements", id, {});
    return row;
  }

  async cancel(adminId: string, id: string): Promise<AnnouncementRow> {
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `UPDATE announcements SET status='cancelled', updated_at=now()
        WHERE announcement_id = $1 AND status IN ('draft','scheduled')
        RETURNING ${SELECT_COLS}`,
      [id],
    );
    if (!row) throw new ApiError("CONFLICT", "Only draft or scheduled announcements can be cancelled");
    await audit(this.pool, adminId, "announcement.cancelled", "announcements", id, {});
    return row;
  }

  /** Soft-delete an announcement (any status). Removes it from admin lists, the
   *  member feed, and the homepage feature. */
  async remove(adminId: string, id: string): Promise<{ deleted: boolean }> {
    const row = await maybeOne<{ announcement_id: string }>(
      this.pool,
      `UPDATE announcements SET deleted_at = now(), is_featured = false, updated_at = now()
        WHERE announcement_id = $1 AND deleted_at IS NULL
        RETURNING announcement_id`,
      [id],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    await audit(this.pool, adminId, "announcement.deleted", "announcements", id, {});
    return { deleted: true };
  }

  /** Feature one announcement on the mobile homepage. Exactly one may be featured
   *  at a time (partial unique index); unset others in the same tx. */
  async setFeatured(adminId: string, id: string, featured: boolean): Promise<{ is_featured: boolean }> {
    return tx(this.pool, async (c) => {
      const a = await maybeOne<{ announcement_id: string }>(c, `SELECT announcement_id FROM announcements WHERE announcement_id = $1 AND deleted_at IS NULL`, [id]);
      if (!a) throw new ApiError("NOT_FOUND", "Announcement not found");
      if (featured) await c.query(`UPDATE announcements SET is_featured = false WHERE is_featured = true`);
      await c.query(`UPDATE announcements SET is_featured = $2, updated_at = now() WHERE announcement_id = $1`, [id, featured]);
      await audit(c, adminId, "announcement.featured", "announcements", id, { featured });
      return { is_featured: featured };
    });
  }

  /** The single homepage-featured announcement for the mobile Home screen (or null). */
  async featured(): Promise<unknown | null> {
    return (
      (await maybeOne(
        this.pool,
        `SELECT announcement_id, title, body, primary_image_url, gallery_image_urls, sent_at
           FROM announcements
          WHERE is_featured = true AND deleted_at IS NULL AND status = 'sent'
          LIMIT 1`,
      )) ?? null
    );
  }

  /** Member-facing detail for one announcement (carousel images + body). Scoped to
   *  members who actually received it (a banner delivery row exists). */
  async memberDetail(userId: string, id: string): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `SELECT a.announcement_id, a.title, a.body, a.sent_at, a.banner_expires_at,
              a.primary_image_url, a.gallery_image_urls,
              d.opened_at IS NOT NULL AS opened
         FROM announcement_deliveries d
         JOIN announcements a USING (announcement_id)
        WHERE d.user_id = $1 AND d.channel = 'banner' AND a.status = 'sent' AND a.deleted_at IS NULL
          AND a.announcement_id = $2`,
      [userId, id],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    const r = row as { primary_image_url: string | null; gallery_image_urls: string[] | null };
    const images = [r.primary_image_url, ...(r.gallery_image_urls ?? [])].filter((u): u is string => !!u);
    return { ...row, images };
  }

  async list(q: z.infer<typeof AnnouncementService.List>): Promise<{ data: unknown[] }> {
    const rows = await many(
      this.pool,
      `SELECT ${SELECT_COLS},
              (SELECT count(*)::int FROM announcement_deliveries d
                WHERE d.announcement_id = a.announcement_id AND d.status IN ('scheduled','delivered')) AS delivered_count,
              (SELECT count(*)::int FROM announcement_deliveries d
                WHERE d.announcement_id = a.announcement_id AND d.opened_at IS NOT NULL) AS opened_count
         FROM announcements a
        WHERE ($1::text IS NULL OR status = $1) AND a.deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2`,
      [q.status ?? null, q.limit],
    );
    return { data: rows };
  }

  /** Detail + per-channel delivered/open stats. */
  async get(id: string): Promise<unknown> {
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `SELECT ${SELECT_COLS} FROM announcements WHERE announcement_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    const stats = await many(
      this.pool,
      `SELECT channel,
              count(*)::int                                              AS targeted,
              count(*) FILTER (WHERE status IN ('scheduled','delivered'))::int AS delivered,
              count(*) FILTER (WHERE status = 'suppressed')::int         AS suppressed,
              count(*) FILTER (WHERE opened_at IS NOT NULL)::int         AS opened
         FROM announcement_deliveries
        WHERE announcement_id = $1
        GROUP BY channel ORDER BY channel`,
      [id],
    );
    return { ...row, stats };
  }

  /**
   * Send now (or dispatch a due scheduled one). Expands the audience to active
   * members and fans out per channel; the UNIQUE delivery row makes the whole
   * fan-out idempotent — a retried send skips recipients already covered.
   */
  async send(adminId: string, id: string): Promise<{ announcement_id: string; recipients: number; deliveries: number }> {
    const ann = await maybeOne<AnnouncementRow>(
      this.pool,
      `SELECT ${SELECT_COLS} FROM announcements WHERE announcement_id = $1`,
      [id],
    );
    if (!ann) throw new ApiError("NOT_FOUND", "Announcement not found");
    if (ann.status === "cancelled" || ann.status === "sent") {
      throw new ApiError("CONFLICT", `Announcement is already ${ann.status}`);
    }

    const recipients = await this.audienceRecipients(this.pool, ann);
    if (recipients.length === 0) throw new ApiError("UNPROCESSABLE", "Audience matches no active members");

    let deliveries = 0;
    for (const r of recipients) {
      for (const channel of ann.channels) {
        const created = await this.deliverOne(ann, r, channel);
        if (created) deliveries += 1;
      }
    }

    await this.pool.query(
      `UPDATE announcements SET status='sent', sent_at=now(), updated_at=now() WHERE announcement_id=$1`,
      [id],
    );
    await audit(this.pool, adminId, "announcement.sent", "announcements", id, {
      recipients: recipients.length,
      deliveries,
      channels: ann.channels,
    });
    return { announcement_id: id, recipients: recipients.length, deliveries };
  }

  /** Scheduler hook: dispatch every scheduled announcement whose time has come. */
  async dispatchDue(now: Date = new Date()): Promise<number> {
    const due = await many<{ announcement_id: string; created_by: string }>(
      this.pool,
      `SELECT announcement_id, created_by FROM announcements
        WHERE status = 'scheduled' AND scheduled_at <= $1
        ORDER BY scheduled_at`,
      [now.toISOString()],
    );
    for (const d of due) await this.send(d.created_by, d.announcement_id);
    return due.length;
  }

  /** Member-facing: my in-app announcements (banner channel), newest first. */
  async myAnnouncements(userId: string): Promise<{ data: unknown[] }> {
    const rows = await many(
      this.pool,
      `SELECT a.announcement_id, a.title, a.body, a.sent_at, a.banner_expires_at,
              a.primary_image_url, a.gallery_image_urls,
              d.opened_at IS NOT NULL AS opened
         FROM announcement_deliveries d
         JOIN announcements a USING (announcement_id)
        WHERE d.user_id = $1 AND d.channel = 'banner' AND a.status = 'sent' AND a.deleted_at IS NULL
          AND (a.banner_expires_at IS NULL OR a.banner_expires_at > now())
        ORDER BY a.sent_at DESC
        LIMIT 50`,
      [userId],
    );
    return { data: rows };
  }

  /** Open receipt (idempotent): stamps opened_at on my deliveries once. */
  async markOpened(userId: string, announcementId: string): Promise<{ opened: boolean }> {
    const res = await this.pool.query(
      `UPDATE announcement_deliveries SET opened_at = now()
        WHERE announcement_id = $1 AND user_id = $2 AND opened_at IS NULL`,
      [announcementId, userId],
    );
    const known = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM announcement_deliveries WHERE announcement_id=$1 AND user_id=$2`,
      [announcementId, userId],
    );
    if (known.n === 0) throw new ApiError("NOT_FOUND", "Announcement not found for this member");
    return { opened: (res.rowCount ?? 0) > 0 };
  }

  // ---- internals ----

  private async audienceRecipients(
    c: Pool | PoolClient,
    ann: AnnouncementRow,
  ): Promise<Array<{ user_id: string; phone_number: string; timezone: string }>> {
    if (ann.audience_kind === "cells") {
      return many(
        c,
        `SELECT user_id, phone_number, timezone FROM users
          WHERE deleted_at IS NULL AND cell_group_id = ANY($1::uuid[])`,
        [ann.audience_cells],
      );
    }
    if (ann.audience_kind === "level") {
      return many(
        c,
        `SELECT u.user_id, u.phone_number, u.timezone FROM users u
          JOIN enrollments e ON e.user_id = u.user_id
         WHERE u.deleted_at IS NULL AND e.current_level = $1`,
        [ann.audience_level],
      );
    }
    return many(c, `SELECT user_id, phone_number, timezone FROM users WHERE deleted_at IS NULL`);
  }

  /** Returns true when a new delivery row was created (false = already done). */
  private async deliverOne(
    ann: AnnouncementRow,
    r: { user_id: string; phone_number: string; timezone: string },
    channel: Channel,
  ): Promise<boolean> {
    return tx(this.pool, async (c) => {
      // Idempotency anchor first: if a row exists, this (recipient, channel)
      // was already handled by a previous (possibly crashed) send.
      const ins = await c.query(
        `INSERT INTO announcement_deliveries (announcement_id, user_id, channel, status)
         VALUES ($1, $2, $3, 'scheduled')
         ON CONFLICT (announcement_id, user_id, channel) DO NOTHING
         RETURNING delivery_id`,
        [ann.announcement_id, r.user_id, channel],
      );
      const deliveryId = (ins.rows[0] as { delivery_id: string } | undefined)?.delivery_id;
      if (!deliveryId) return false;

      if (channel === "push" || channel === "email") {
        // Quiet hours + daily cap apply exactly as for any nudge (§1.5).
        const n = await this.notifications.schedule({
          userId: r.user_id,
          channel,
          template: "announcement",
          payload: { announcement_id: ann.announcement_id, title: ann.title },
          timezone: r.timezone,
        });
        await c.query(
          `UPDATE announcement_deliveries
              SET notification_id = $2, status = $3
            WHERE delivery_id = $1`,
          [deliveryId, n.notification_id, n.status === "suppressed" ? "suppressed" : "scheduled"],
        );
      } else if (channel === "sms" || channel === "whatsapp") {
        try {
          const sent = await this.providers[channel].send({
            to: r.phone_number,
            title: ann.title,
            body: ann.body,
          });
          await c.query(
            `UPDATE announcement_deliveries
                SET provider_ref = $2, status = 'delivered', delivered_at = now()
              WHERE delivery_id = $1`,
            [deliveryId, sent.ref],
          );
        } catch {
          await c.query(`UPDATE announcement_deliveries SET status = 'failed' WHERE delivery_id = $1`, [deliveryId]);
        }
      } else {
        // banner: delivered the moment the row exists — members fetch it in-app.
        await c.query(
          `UPDATE announcement_deliveries SET status = 'delivered', delivered_at = now() WHERE delivery_id = $1`,
          [deliveryId],
        );
      }
      return true;
    });
  }
}
