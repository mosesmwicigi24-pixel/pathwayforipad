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

  /**
   * Per-level curriculum analytics for the "Curriculum Levels" page: module
   * counts, enrolled learners (by current_level), completion of published
   * modules, certificates issued — plus a 6-month enrolment trend by level.
   * Everything aggregated from authoritative tables.
   */
  async levelsReport(): Promise<Record<string, unknown>> {
    const levels = await many(
      this.replica,
      `WITH mod AS (
         SELECT level_number,
                count(*)::int                                            AS modules_total,
                count(*) FILTER (WHERE status = 'published')::int        AS modules_published,
                count(*) FILTER (WHERE status = 'draft')::int            AS modules_draft,
                count(*) FILTER (WHERE status = 'archived')::int         AS modules_archived
           FROM modules GROUP BY level_number
       ),
       enr AS (
         SELECT current_level AS level_number, count(*)::int AS learners
           FROM enrollments GROUP BY current_level
       ),
       done AS (
         SELECT m.level_number, count(*)::int AS completed
           FROM module_progress mp
           JOIN modules m       ON m.module_id = mp.module_id AND m.status = 'published'
           JOIN enrollments e   ON e.enrollment_id = mp.enrollment_id AND e.current_level = m.level_number
          WHERE mp.is_completed
          GROUP BY m.level_number
       ),
       cert AS (
         SELECT level_number, count(*)::int AS certificates
           FROM certificates WHERE level_number IS NOT NULL AND revoked_at IS NULL
          GROUP BY level_number
       )
       SELECT l.level_number, l.title, l.theme, l.duration, l.status, l.color,
              COALESCE(mod.modules_total, 0)     AS modules_total,
              COALESCE(mod.modules_published, 0) AS modules_published,
              COALESCE(mod.modules_draft, 0)     AS modules_draft,
              COALESCE(mod.modules_archived, 0)  AS modules_archived,
              COALESCE(enr.learners, 0)          AS learners,
              CASE WHEN COALESCE(enr.learners,0) > 0 AND COALESCE(mod.modules_published,0) > 0
                   THEN round(COALESCE(done.completed,0)::numeric
                              / (enr.learners * mod.modules_published) * 100)::int
                   ELSE 0 END                    AS completion_pct,
              COALESCE(cert.certificates, 0)     AS certificates
         FROM levels l
         LEFT JOIN mod  ON mod.level_number  = l.level_number
         LEFT JOIN enr  ON enr.level_number  = l.level_number
         LEFT JOIN done ON done.level_number = l.level_number
         LEFT JOIN cert ON cert.level_number = l.level_number
        ORDER BY l.level_number`,
    );

    const trendRows = await many<{ ym: string; mon: string; level_number: number; n: number }>(
      this.replica,
      `SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS ym,
              to_char(date_trunc('month', started_at), 'Mon')     AS mon,
              current_level AS level_number,
              count(*)::int AS n
         FROM enrollments
        WHERE started_at >= date_trunc('month', now()) - interval '5 months'
        GROUP BY 1, 2, current_level
        ORDER BY 1`,
    );
    const months = [...new Set(trendRows.map((r) => r.ym))].sort();
    const trend = months.map((ym) => {
      const mon = trendRows.find((r) => r.ym === ym)?.mon ?? ym;
      const point: Record<string, string | number> = { month: mon };
      for (const r of trendRows.filter((x) => x.ym === ym)) point[`L${r.level_number}`] = r.n;
      return point;
    });

    return { levels, trend };
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

  // ---------------- Notifications feed ----------------

  /**
   * Portal activity feed for the top-bar bell + Notifications page. Synthesized
   * from real events (pending reflections, issued certificates, new members,
   * at-risk engagement, and RBAC audit entries) — never invented. Read/dismiss
   * state is tracked per-admin on the client; this is the authoritative content.
   */
  async notificationsFeed(): Promise<unknown[]> {
    return many(
      this.replica,
      `SELECT * FROM (
         SELECT 'rfl-' || mr.reflection_id::text AS id,
                'New reflection submitted' AS title,
                u.full_name || ' submitted a reflection for review.' AS message,
                'info' AS category, mr.submitted_at AS at, '/reflection-queue' AS href
           FROM module_reflections mr JOIN users u ON u.user_id = mr.user_id
          WHERE mr.state = 'pending'
         UNION ALL
         SELECT 'cert-' || c.certificate_id::text, 'Certificate issued',
                'A completion certificate was issued to ' || u.full_name || '.',
                'success', c.issued_at, '/certificates'
           FROM certificates c JOIN users u ON u.user_id = c.user_id
         UNION ALL
         SELECT 'mbr-' || u.user_id::text, 'New member added',
                u.full_name || ' joined the pathway.', 'info', u.created_at, '/members'
           FROM users u WHERE u.role = 'Student' AND u.deleted_at IS NULL
         UNION ALL
         SELECT 'eng-' || es.user_id::text, 'Engagement alert',
                u.full_name || ' is flagged ' || es.band::text || '.',
                'warning', es.window_end::timestamptz, '/cell-engagement'
           FROM engagement_scores es JOIN users u ON u.user_id = es.user_id
          WHERE es.band IN ('at_risk','watch')
         UNION ALL
         SELECT 'aud-' || a.audit_id::text,
                CASE WHEN a.action LIKE 'role.%' THEN 'Roles & permissions updated'
                     WHEN a.action LIKE 'user.%' THEN 'User account updated'
                     ELSE a.action END,
                a.action, 'security', a.occurred_at,
                CASE WHEN a.action LIKE 'role.%' THEN '/roles' ELSE '/users' END
           FROM audit_log a WHERE a.action LIKE 'role.%' OR a.action LIKE 'user.%'
       ) feed
       ORDER BY at DESC
       LIMIT 60`,
    );
  }

  // ---------------- Member profile (aggregate) ----------------

  // Human labels for the interaction_events.kind feed. Activity is metadata only —
  // reflection/prayer CONTENT is pastorally private and never surfaced here (§5.4).
  private static readonly ACTIVITY_LABELS: Record<string, string> = {
    lesson_open: "Opened a lesson",
    scripture_read: "Read scripture",
    video_75pct: "Watched a teaching video",
    reflection_submitted: "Submitted a reflection",
    quiz_passed: "Passed a quiz",
    quiz_attempt: "Attempted a quiz",
    module_completed: "Completed a module",
    prayer_logged: "Logged a prayer",
    check_in: "Daily check-in",
  };

  /**
   * Single-member aggregate for the portal Member Profile screen. Pulls identity,
   * placement, engagement band, curriculum/attendance/habit metrics, guardian
   * consent (minors), certificates, badges and a recent activity feed — all from
   * authoritative tables. No reflection/prayer content is ever returned (§5.4).
   */
  async memberDetail(userId: string): Promise<Record<string, unknown>> {
    const m = await maybeOne<Record<string, unknown>>(
      this.replica,
      `SELECT u.user_id, u.full_name, u.email, u.phone_number, u.is_baptized, u.locale,
              u.created_at, u.date_of_birth,
              (u.date_of_birth > CURRENT_DATE - INTERVAL '18 years') AS is_minor,
              cg.cell_group_id, cg.name AS cell_name,
              lang.name AS language_name,
              en.current_level, en.start_level, en.state AS enrollment_state,
              en.started_at, en.completed_at,
              lv.title AS level_title,
              es.e_score::float AS e_score, es.band::text AS band,
              st.current_streak_days, st.longest_streak_days, st.last_active_date,
              (SELECT max(ie.occurred_at) FROM interaction_events ie WHERE ie.user_id = u.user_id) AS last_activity
         FROM users u
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
         LEFT JOIN languages lang ON lang.code = u.locale
         LEFT JOIN enrollments en ON en.user_id = u.user_id
         LEFT JOIN levels lv ON lv.level_number = en.current_level
         LEFT JOIN engagement_scores es ON es.user_id = u.user_id
         LEFT JOIN user_streaks st ON st.user_id = u.user_id
        WHERE u.user_id = $1 AND u.role = 'Student' AND u.deleted_at IS NULL`,
      [userId],
    );
    if (!m) throw new ApiError("NOT_FOUND", "Member not found");

    const currentLevel = (m.current_level as number | null) ?? 1;

    // Curriculum: completed modules vs. published modules in the current level.
    const curr = await one<{ done: string; total: string }>(
      this.replica,
      `SELECT
          (SELECT count(*) FROM module_progress mp
             JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
             JOIN modules md ON md.module_id = mp.module_id
            WHERE e.user_id = $1 AND mp.is_completed AND md.level_number = $2) AS done,
          (SELECT count(*) FROM modules md
            WHERE md.level_number = $2 AND md.status = 'published') AS total`,
      [userId, currentLevel],
    );
    const modulesDone = Number(curr.done);
    const modulesTotal = Number(curr.total);
    const curriculumPct = modulesTotal > 0 ? Math.round((modulesDone / modulesTotal) * 100) : 0;

    // Attendance: member check-ins vs. congregation events over the last 90 days.
    const att = await one<{ attended: string; held: string }>(
      this.replica,
      `SELECT
          (SELECT count(*) FROM attendance_logs al
            WHERE al.user_id = $1 AND al.checked_in_at >= now() - INTERVAL '90 days') AS attended,
          (SELECT count(DISTINCT al.event_id) FROM attendance_logs al
            WHERE al.checked_in_at >= now() - INTERVAL '90 days') AS held`,
      [userId],
    );
    const attended = Number(att.attended);
    const held = Number(att.held);
    const attendancePct = held > 0 ? Math.min(100, Math.round((attended / held) * 100)) : 0;

    // Habits: distinct active days in the last 30 (derived from interaction_events).
    const habit = await one<{ active_days: string }>(
      this.replica,
      `SELECT count(DISTINCT date_trunc('day', ie.occurred_at)) AS active_days
         FROM interaction_events ie
        WHERE ie.user_id = $1 AND ie.occurred_at >= now() - INTERVAL '30 days'`,
      [userId],
    );
    const activeDays = Number(habit.active_days);
    const habitsPct = Math.min(100, Math.round((activeDays / 30) * 100));

    // Guardian consent (minors only) — name/relation/dates are admin-safe; the
    // encrypted contact blob is intentionally not returned.
    const guardian = (m.is_minor as boolean)
      ? await maybeOne<Record<string, unknown>>(
          this.replica,
          `SELECT guardian_name, relationship, granted_at, revoked_at, consent_text_version
             FROM guardian_consents
            WHERE user_id = $1
            ORDER BY (revoked_at IS NULL) DESC, granted_at DESC
            LIMIT 1`,
          [userId],
        )
      : null;

    const certificates = await many<Record<string, unknown>>(
      this.replica,
      `SELECT c.certificate_id, c.level_number, c.verification_code, c.issued_at,
              COALESCE(lv.title, 'Full Pathway') AS level_title
         FROM certificates c LEFT JOIN levels lv ON lv.level_number = c.level_number
        WHERE c.user_id = $1 ORDER BY c.issued_at DESC`,
      [userId],
    );

    const badges = await many<Record<string, unknown>>(
      this.replica,
      `SELECT b.code, b.name, b.description, b.category::text, b.icon_key, ub.awarded_at
         FROM user_badges ub JOIN badges b ON b.badge_id = ub.badge_id
        WHERE ub.user_id = $1 AND ub.revoked_at IS NULL
        ORDER BY ub.awarded_at DESC`,
      [userId],
    );

    const events = await many<{ kind: string; occurred_at: string; module_title: string | null }>(
      this.replica,
      `SELECT ie.kind, ie.occurred_at, md.title AS module_title
         FROM interaction_events ie LEFT JOIN modules md ON md.module_id = ie.module_id
        WHERE ie.user_id = $1
        ORDER BY ie.occurred_at DESC
        LIMIT 12`,
      [userId],
    );
    const timeline = events.map((e) => ({
      kind: e.kind,
      label: AdminOpsService.ACTIVITY_LABELS[e.kind] ?? e.kind.replace(/_/g, " "),
      module_title: e.module_title,
      occurred_at: e.occurred_at,
    }));

    return {
      user_id: m.user_id,
      full_name: m.full_name,
      email: m.email,
      phone_number: m.phone_number,
      is_minor: m.is_minor,
      is_baptized: m.is_baptized,
      cell_group_id: m.cell_group_id,
      cell_name: m.cell_name,
      language: m.language_name ?? m.locale,
      created_at: m.created_at,
      last_activity: m.last_activity,
      enrollment: {
        current_level: currentLevel,
        level_title: m.level_title,
        start_level: m.start_level,
        state: m.enrollment_state,
        started_at: m.started_at,
        completed_at: m.completed_at,
      },
      engagement: { e_score: m.e_score, band: m.band },
      metrics: {
        habits_pct: habitsPct,
        active_days_30: activeDays,
        curriculum_pct: curriculumPct,
        modules_done: modulesDone,
        modules_total: modulesTotal,
        attendance_pct: attendancePct,
        attended,
        events_held: held,
        current_streak_days: m.current_streak_days ?? 0,
        longest_streak_days: m.longest_streak_days ?? 0,
      },
      guardian: guardian
        ? {
            name: guardian.guardian_name,
            relationship: guardian.relationship,
            consent: guardian.revoked_at ? "Revoked" : "Granted",
            granted_at: guardian.granted_at,
            revoked_at: guardian.revoked_at,
            consent_version: guardian.consent_text_version,
          }
        : null,
      certificates,
      badges,
      timeline,
    };
  }
}
