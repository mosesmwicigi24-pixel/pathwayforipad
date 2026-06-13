// Admin operations / ERP reads (Design Contract Matrix B1; web portal "ERP").
// Dashboard report aggregates, congregation-wide member administration, and the
// audit viewer. All Admin+ (audit: SuperAdmin); reads hit the replica where one
// is configured (§1.6). Every aggregate is computed from the authoritative
// tables — nothing here is client-supplied.
import type { Pool } from "pg";
import { z } from "zod";
import { many, one, maybeOne, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export class AdminOpsService {
  constructor(
    private readonly pool: Pool,
    private readonly replica: Pool = pool,
  ) {}

  // ---------------- Dashboard reports ----------------

  /** The portal dashboard KPI block (one round trip). */
  async overview(): Promise<Record<string, unknown>> {
    const row = await one<Record<string, string>>(
      this.replica,
      `SELECT
         (SELECT count(*) FROM users WHERE role = 'Student' AND deleted_at IS NULL)            AS total_members,
         (SELECT count(DISTINCT user_id) FROM interaction_events
           WHERE occurred_at >= now() - interval '7 days')                                     AS active_learners,
         (SELECT COALESCE(round(avg(e_score), 3), 0) FROM engagement_scores)                   AS avg_engagement,
         (SELECT count(*) FROM engagement_scores WHERE band = 'at_risk')                       AS members_at_risk,
         (SELECT count(*) FROM certificates
           WHERE issued_at >= date_trunc('month', now()) AND revoked_at IS NULL)               AS certificates_this_month,
         (SELECT count(*) FROM reflection_reviews
           WHERE submitted_at >= now() - interval '7 days')                                    AS reflections_this_week,
         (SELECT count(*) FROM reflection_reviews WHERE state = 'pending')                     AS pending_reviews,
         (SELECT count(*) FROM reflection_reviews
           WHERE state = 'pending' AND submitted_at < now() - interval '3 days')               AS reviews_overdue,
         (SELECT count(*) FROM modules WHERE status = 'published')                             AS modules_published,
         (SELECT count(*) FROM cell_groups)                                                    AS cohorts_running,
         (SELECT count(*) FROM attendance_logs
           WHERE checked_in_at >= date_trunc('week', now()))                                   AS checked_in_this_week`,
    );
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
  }

  /** Engagement band distribution + lowest-engagement cells (the watch list). */
  async engagementReport(): Promise<Record<string, unknown>> {
    const bands = await many<{ band: string; n: string }>(
      this.replica,
      `SELECT band::text, count(*)::text AS n FROM engagement_scores GROUP BY band`,
    );
    const cells = await many(
      this.replica,
      `SELECT cg.cell_group_id, cg.name,
              count(es.user_id)::int                       AS members,
              COALESCE(round(avg(es.e_score), 3), 0)::float AS avg_engagement,
              count(*) FILTER (WHERE es.band = 'at_risk')::int AS at_risk
         FROM cell_groups cg
         LEFT JOIN engagement_scores es ON es.cell_group_id = cg.cell_group_id
        GROUP BY cg.cell_group_id, cg.name
        ORDER BY avg_engagement ASC NULLS LAST
        LIMIT 50`,
    );
    return {
      bands: Object.fromEntries(bands.map((b) => [b.band, Number(b.n)])),
      cells,
    };
  }

  /** Weekly attendance trend (last `weeks`) + this-week summary. */
  async attendanceReport(weeks = 8): Promise<Record<string, unknown>> {
    const trend = await many(
      this.replica,
      `SELECT date_trunc('week', checked_in_at)::date::text AS week_start,
              count(*)::int                                 AS check_ins,
              count(DISTINCT user_id)::int                  AS unique_members
         FROM attendance_logs
        WHERE checked_in_at >= date_trunc('week', now()) - ($1 - 1) * interval '1 week'
        GROUP BY 1 ORDER BY 1`,
      [weeks],
    );
    const events = await many(
      this.replica,
      `SELECT e.event_id, e.title, e.occurs_at,
              count(al.attendance_id)::int AS checked_in,
              count(r.rsvp_id) FILTER (WHERE r.status = 'going')::int AS rsvp_going
         FROM events e
         LEFT JOIN attendance_logs al ON al.event_id = e.event_id
         LEFT JOIN event_rsvps r ON r.event_id = e.event_id
        WHERE e.occurs_at >= now() - interval '30 days'
        GROUP BY e.event_id ORDER BY e.occurs_at DESC LIMIT 25`,
    );
    return { trend, recent_events: events };
  }

  /**
   * Guardian consents needing renewal (§5.9 posture: annual). "Expiring" =
   * granted > 11 months ago, unrevoked, and the member is still a minor.
   */
  async consentsReport(): Promise<unknown[]> {
    return many(
      this.replica,
      `SELECT gc.consent_id, gc.user_id, u.full_name, gc.guardian_name,
              gc.relationship, gc.granted_at,
              (gc.granted_at + interval '12 months')::date::text AS renew_by
         FROM guardian_consents gc
         JOIN users u ON u.user_id = gc.user_id
        WHERE gc.revoked_at IS NULL AND u.is_minor
          AND gc.granted_at < now() - interval '11 months'
        ORDER BY gc.granted_at ASC
        LIMIT 100`,
    );
  }

  // ---------------- Members administration ----------------

  static readonly ListMembers = z.object({
    search: z.string().max(120).optional(),
    cell_group_id: z.string().uuid().optional(),
    band: z.enum(["thriving", "steady", "watch", "at_risk"]).optional(),
    level: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().uuid().optional(), // keyset: last user_id of the prior page
  });

  /** Congregation-wide member list for the ERP Members screen. */
  async listMembers(q: z.infer<typeof AdminOpsService.ListMembers>): Promise<{ data: unknown[]; next_cursor: string | null }> {
    const params: unknown[] = [];
    const where: string[] = [`u.role = 'Student'`, `u.deleted_at IS NULL`];
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`u.full_name ILIKE $${params.length}`);
    }
    if (q.cell_group_id) {
      params.push(q.cell_group_id);
      where.push(`u.cell_group_id = $${params.length}`);
    }
    if (q.band) {
      params.push(q.band);
      where.push(`es.band = $${params.length}::engagement_band`);
    }
    if (q.level) {
      params.push(q.level);
      where.push(`en.current_level = $${params.length}`);
    }
    if (q.cursor) {
      params.push(q.cursor);
      where.push(`u.user_id > $${params.length}::uuid`);
    }
    params.push(q.limit + 1);

    const rows = await many<Record<string, unknown>>(
      this.replica,
      `SELECT u.user_id, u.full_name, u.email, u.phone_number, u.is_minor, u.created_at,
              cg.name AS cell_name, u.cell_group_id,
              en.current_level, en.start_level, en.start_module_sequence,
              es.e_score::float, es.band::text,
              (SELECT max(ie.occurred_at) FROM interaction_events ie WHERE ie.user_id = u.user_id) AS last_activity
         FROM users u
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
         LEFT JOIN enrollments en ON en.user_id = u.user_id
         LEFT JOIN engagement_scores es ON es.user_id = u.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY u.user_id
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return { data: page, next_cursor: hasMore && last ? String(last.user_id) : null };
  }

  static readonly AddMember = z
    .object({
      full_name: z.string().min(1).max(255),
      phone_number: z.string().min(7).max(32),
      email: z.string().email().optional(),
      date_of_birth: z.string().optional(), // ISO date
      cell_group_id: z.string().uuid(),
      // Optional placement at registration; defaults to Level 1 · Module 1.
      start_level: z.coerce.number().int().min(1).default(1),
      start_module_sequence: z.coerce.number().int().min(1).default(1),
    })
    .strict();

  /**
   * Validate an admin-set starting point: the level must exist and a published
   * module must occupy that sequence. Used by both addMember and setEnrollmentStart
   * so the gating engine never opens a non-existent entry (§1.9).
   */
  private async validateStart(c: Queryable, level: number, seq: number): Promise<void> {
    // The canonical entry (Level 1 · Module 1) is always valid — the gating engine
    // opens it unconditionally — so a default placement needs no curriculum yet.
    if (level === 1 && seq === 1) return;
    const lvl = await maybeOne(c, `SELECT 1 FROM levels WHERE level_number = $1`, [level]);
    if (!lvl) throw new ApiError("VALIDATION_FAILED", "Unknown level");
    const mod = await maybeOne(
      c,
      `SELECT 1 FROM modules WHERE level_number = $1 AND module_sequence_number = $2 AND is_published = TRUE`,
      [level, seq],
    );
    if (!mod) {
      throw new ApiError("VALIDATION_FAILED", "No published module at that level and position", {
        start_level: level,
        start_module_sequence: seq,
      });
    }
  }

  /** "Add learner": create a Student in a cell + an enrollment at the chosen
   *  starting point (default L1·M1). Audited. */
  async addMember(adminId: string, input: z.infer<typeof AdminOpsService.AddMember>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cell = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM cell_groups WHERE cell_group_id = $1`,
        [input.cell_group_id],
      );
      if (!cell) throw new ApiError("VALIDATION_FAILED", "Unknown cell group");
      await this.validateStart(c, input.start_level, input.start_module_sequence);

      const user = await one<{ user_id: string }>(
        c,
        `INSERT INTO users (full_name, phone_number, email, date_of_birth, cell_group_id, congregation_id, role)
         VALUES ($1,$2,$3,$4,$5,$6,'Student') RETURNING user_id`,
        [
          input.full_name,
          input.phone_number,
          input.email ?? null,
          input.date_of_birth ?? null,
          input.cell_group_id,
          cell.congregation_id,
        ],
      );
      await c.query(
        `INSERT INTO enrollments (user_id, current_level, start_level, start_module_sequence)
         VALUES ($1, $2, $2, $3)`,
        [user.user_id, input.start_level, input.start_module_sequence],
      );
      await audit(c, adminId, "member.added", "users", user.user_id, {
        cell_group_id: input.cell_group_id,
        start_level: input.start_level,
        start_module_sequence: input.start_module_sequence,
      });
      return one(
        c,
        `SELECT user_id, full_name, email, phone_number, cell_group_id, congregation_id, created_at
           FROM users WHERE user_id = $1`,
        [user.user_id],
      );
    });
  }

  static readonly SetStart = z
    .object({
      start_level: z.coerce.number().int().min(1),
      start_module_sequence: z.coerce.number().int().min(1).default(1),
    })
    .strict();

  /**
   * Move a member's Pathway entry point (admin placement). Sets current_level to
   * the chosen level and records the entry module sequence. The §1.9 hard-lock
   * ceiling still applies — nothing above current_level unlocks — and the level
   * exam + reflection gates still govern advancement (scoped to the entry point).
   */
  async setEnrollmentStart(
    adminId: string,
    userId: string,
    input: z.infer<typeof AdminOpsService.SetStart>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const enrollment = await maybeOne<{ enrollment_id: string }>(
        c,
        `SELECT enrollment_id FROM enrollments WHERE user_id = $1`,
        [userId],
      );
      if (!enrollment) throw new ApiError("NOT_FOUND", "Member has no enrollment");
      await this.validateStart(c, input.start_level, input.start_module_sequence);

      await c.query(
        `UPDATE enrollments
            SET current_level = $1, start_level = $1, start_module_sequence = $2
          WHERE user_id = $3`,
        [input.start_level, input.start_module_sequence, userId],
      );
      await audit(c, adminId, "enrollment.start_set", "enrollments", enrollment.enrollment_id, {
        user_id: userId,
        start_level: input.start_level,
        start_module_sequence: input.start_module_sequence,
      });
      return one(
        c,
        `SELECT u.user_id, u.full_name, en.current_level, en.start_level, en.start_module_sequence
           FROM users u JOIN enrollments en ON en.user_id = u.user_id
          WHERE u.user_id = $1`,
        [userId],
      );
    });
  }

  // ---------------- Audit viewer (SuperAdmin) ----------------

  static readonly ListAudit = z.object({
    actor_id: z.string().uuid().optional(),
    action: z.string().max(80).optional(),
    entity: z.string().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.number().int().positive().optional(), // keyset on audit_id
  });

  async listAudit(q: z.infer<typeof AdminOpsService.ListAudit>): Promise<{ data: unknown[]; next_cursor: number | null }> {
    const params: unknown[] = [];
    const where: string[] = ["TRUE"];
    if (q.actor_id) {
      params.push(q.actor_id);
      where.push(`a.actor_id = $${params.length}`);
    }
    if (q.action) {
      params.push(`${q.action}%`);
      where.push(`a.action LIKE $${params.length}`);
    }
    if (q.entity) {
      params.push(q.entity);
      where.push(`a.entity = $${params.length}`);
    }
    if (q.before) {
      params.push(q.before);
      where.push(`a.audit_id < $${params.length}`);
    }
    params.push(q.limit + 1);

    const rows = await many<Record<string, unknown>>(
      this.replica,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.entity,
              a.entity_id, a.metadata, a.occurred_at
         FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE ${where.join(" AND ")}
        ORDER BY a.audit_id DESC
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return { data: page, next_cursor: hasMore && last ? Number(last.audit_id) : null };
  }
}
