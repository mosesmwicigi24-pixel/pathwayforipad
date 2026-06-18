// Calendar service (Features v2 §C). Visibility-scoped series CRUD, TZ-aware
// occurrence projection, occurrence materialization (so QR attendance keeps a
// stable event_id), RSVPs (offline-queueable), and chrono-node quick-add. All
// server-authoritative; recurrence is validated + capped (§C.4).
import { randomUUID, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { many, maybeOne, one, tx, recordChange, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { validateRrule, expandOccurrences, type Occurrence } from "./recurrence.js";
import { NotificationService } from "../notifications/service.js";

const MAX_RANGE_DAYS = 92;

interface SeriesRow {
  series_id: string;
  congregation_id: string;
  cell_group_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  timezone: string;
  dtstart_local: string;
  duration_min: number;
  rrule: string | null;
  visibility: "congregation" | "cell" | "leaders";
  rsvp_enabled?: boolean;
  qr_enabled?: boolean;
  reminders_enabled?: boolean;
  checkin_opens_min_before?: number | null;
  is_paused?: boolean;
  status?: "draft" | "active";
}

// The admin portal's Create-event modal posts a richer, UI-shaped payload than
// the series model: separate start_date / start_time (or a precomputed
// starts_at) rather than dtstart_local, a member-facing visibility vocabulary,
// and a few presentational fields (category, manual_checkin_enabled, …).
// Normalize it to the series schema so creation succeeds whatever client shape
// arrives, then let zod validate the normalized object. Unknown keys are dropped.
function normalizeSeriesInput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;

  const startDate = typeof r.start_date === "string" ? r.start_date.trim() : "";
  const startTime = typeof r.start_time === "string" && r.start_time.trim() ? r.start_time.trim() : "09:00";
  const dtstartLocal =
    (typeof r.dtstart_local === "string" && r.dtstart_local) ||
    (startDate ? `${startDate}T${startTime}:00` : undefined) ||
    (typeof r.starts_at === "string" && r.starts_at ? r.starts_at : undefined);

  // Map the UI's visibility words onto the DB enum (congregation | cell | leaders).
  const visAliases: Record<string, "congregation" | "cell" | "leaders"> = {
    members: "congregation",
    member: "congregation",
    public: "congregation",
    all: "congregation",
    congregation: "congregation",
    cell: "cell",
    cells: "cell",
    leaders: "leaders",
    leader: "leaders",
  };
  const visibility =
    typeof r.visibility === "string" ? (visAliases[r.visibility.toLowerCase()] ?? r.visibility) : r.visibility;

  // The portal builds open-ended rules (FREQ=WEEKLY;BYDAY=SU, …), but the spec
  // (§C.4) forbids unbounded recurrence. Bound any rule that lacks COUNT/UNTIL to
  // a default 12-month horizon so the portal's payload validates.
  let rrule = r.rrule;
  if (typeof rrule === "string" && rrule.trim()) {
    const up = rrule.toUpperCase();
    if (!up.includes("COUNT=") && !up.includes("UNTIL=")) {
      const until = DateTime.utc().plus({ months: 12 }).toFormat("yyyyLLdd'T'HHmmss'Z'");
      rrule = `${rrule.trim()};UNTIL=${until}`;
    }
  }

  const out: Record<string, unknown> = {
    title: r.title,
    description: r.description,
    location: r.location,
    timezone: r.timezone,
    duration_min: r.duration_min,
    rrule,
    rsvp_enabled: r.rsvp_enabled,
    qr_enabled: r.qr_enabled,
    reminders_enabled: r.reminders_enabled,
    checkin_opens_min_before: r.checkin_opens_min_before,
  };
  if (r.cell_group_id !== undefined) out.cell_group_id = r.cell_group_id;
  if (dtstartLocal !== undefined) out.dtstart_local = dtstartLocal;
  if (visibility !== undefined) out.visibility = visibility;
  if (r.status !== undefined) out.status = r.status;
  return out;
}

interface UserScope {
  congregation_id: string;
  cell_group_id: string | null;
  role: string;
  leaderCells: string[];
  isLeader: boolean;
}

export class CalendarService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    private readonly horizonDays: number = 35,
    private readonly maxInstances: number = 500,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  private async scopeOf(c: Queryable, userId: string): Promise<UserScope> {
    const u = await one<{ congregation_id: string; cell_group_id: string | null; role: string }>(
      c,
      `SELECT congregation_id, cell_group_id, role FROM users WHERE user_id = $1`,
      [userId],
    );
    const cells = await many<{ cell_group_id: string }>(
      c,
      `SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1`,
      [userId],
    );
    const isLeader = u.role === "Instructor" || u.role === "Admin" || u.role === "SuperAdmin";
    return { ...u, leaderCells: cells.map((r) => r.cell_group_id), isLeader };
  }

  private visibleSeries(c: Queryable, scope: UserScope): Promise<SeriesRow[]> {
    return many<SeriesRow>(
      c,
      `SELECT series_id, congregation_id, cell_group_id, title, description, location, timezone,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
              duration_min, rrule, visibility, is_paused, status
         FROM event_series es
        WHERE es.deleted_at IS NULL AND es.is_paused = FALSE AND es.congregation_id = $1
          -- Drafts are visible only to leaders/admins ($4), never to members.
          AND (es.status = 'active' OR $4)
          AND (
            es.visibility = 'congregation'
            OR (es.visibility = 'cell' AND (es.cell_group_id = $2 OR es.cell_group_id = ANY($3::uuid[])))
            OR (es.visibility = 'leaders' AND $4 AND (es.cell_group_id IS NULL OR es.cell_group_id = $2 OR es.cell_group_id = ANY($3::uuid[])))
          )`,
      [scope.congregation_id, scope.cell_group_id, scope.leaderCells, scope.isLeader],
    );
  }

  /** Projected occurrences in [from,to] (≤ 92 days), TZ-aware, exceptions applied. */
  async projectRange(userId: string, fromIso: string, toIso: string): Promise<unknown[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new ApiError("VALIDATION_FAILED", "Invalid from/to range");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new ApiError("VALIDATION_FAILED", `Range must be ≤ ${MAX_RANGE_DAYS} days`);
    }
    const scope = await this.scopeOf(this.pool, userId);
    const series = await this.visibleSeries(this.pool, scope);
    const out: unknown[] = [];
    for (const s of series) {
      const occ = expandOccurrences(s, from, to, this.maxInstances);
      const exceptions = await many<{ original_start_at: string; is_cancelled: boolean; new_start_at: string | null; new_end_at: string | null }>(
        this.pool,
        `SELECT original_start_at, is_cancelled, new_start_at, new_end_at FROM event_exceptions WHERE series_id = $1`,
        [s.series_id],
      );
      const exByStart = new Map(exceptions.map((e) => [new Date(e.original_start_at).getTime(), e]));
      for (const o of occ) {
        const ex = exByStart.get(new Date(o.start_at).getTime());
        if (ex?.is_cancelled) continue;
        const start = ex?.new_start_at ?? o.start_at;
        const end = ex?.new_end_at ?? o.end_at;
        out.push({
          occurrence_id: occurrenceId(s.series_id, o.start_at),
          series_id: s.series_id,
          title: s.title,
          location: s.location,
          visibility: s.visibility,
          status: s.status ?? "active",
          cell_group_id: s.cell_group_id,
          start_at: start,
          end_at: end,
          original_start_at: o.start_at,
          rescheduled: Boolean(ex && !ex.is_cancelled && ex.new_start_at),
        });
      }
    }
    out.sort((a, b) => String((a as { start_at: string }).start_at).localeCompare(String((b as { start_at: string }).start_at)));
    return out;
  }

  // ---------------- Admin: series CRUD ----------------

  // Canonical series fields. The wire payload is normalized first (see
  // normalizeSeriesInput) so both the mobile/canonical shape and the admin
  // portal's Create-event shape validate against this.
  static readonly SeriesShape = z.object({
    cell_group_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(255),
    description: z.string().nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    timezone: z.string().min(1).max(64),
    dtstart_local: z.string().min(1), // ISO-ish wall clock
    duration_min: z.number().int().min(5).max(720),
    rrule: z.string().nullable().optional(),
    visibility: z.enum(["congregation", "cell", "leaders"]).default("cell"),
    // Ops toggles (Contract Matrix B2) — copied onto materialized occurrences.
    rsvp_enabled: z.boolean().default(true),
    qr_enabled: z.boolean().default(true),
    reminders_enabled: z.boolean().default(true),
    checkin_opens_min_before: z.number().int().min(0).max(1440).nullable().optional(),
    // Draft series are recorded but not materialized or shown to members.
    status: z.enum(["draft", "active"]).default("active"),
  });

  static readonly CreateSeries = z.preprocess(normalizeSeriesInput, CalendarService.SeriesShape);

  async createSeries(principal: Principal, input: z.infer<typeof CalendarService.CreateSeries>): Promise<unknown> {
    if (input.rrule) validateRrule(input.rrule);
    if (!DateTime.now().setZone(input.timezone).isValid) {
      throw new ApiError("VALIDATION_FAILED", "Invalid IANA timezone");
    }
    return tx(this.pool, async (c) => {
      // Creation rights: Instructor for assigned cells; Admin+ congregation-wide.
      await this.assertCreateRight(c, principal, input.cell_group_id ?? null, input.visibility);
      const row = await one<{ series_id: string }>(
        c,
        `INSERT INTO event_series
           (congregation_id, cell_group_id, title, description, location, timezone, dtstart_local, duration_min, rrule, visibility, created_by,
            rsvp_enabled, qr_enabled, reminders_enabled, checkin_opens_min_before, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING series_id`,
        [
          principal.congregationId,
          input.cell_group_id ?? null,
          input.title,
          input.description ?? null,
          input.location ?? null,
          input.timezone,
          input.dtstart_local,
          input.duration_min,
          input.rrule ?? null,
          input.visibility,
          principal.userId,
          input.rsvp_enabled ?? true,
          input.qr_enabled ?? true,
          input.reminders_enabled ?? true,
          input.checkin_opens_min_before ?? null,
          input.status ?? "active",
        ],
      );
      // Drafts are not materialized (no occurrences / reminders) until published.
      if ((input.status ?? "active") !== "draft") {
        await enqueueOutbox(c, "calendar.materialize", { series_id: row.series_id });
      }
      await audit(c, principal.userId, "calendar.series_created", "event_series", row.series_id, { status: input.status ?? "active" });
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [row.series_id]);
    });
  }

  private async assertCreateRight(
    c: Queryable,
    principal: Principal,
    cellGroupId: string | null,
    visibility: string,
  ): Promise<void> {
    if (principal.role === "Admin" || principal.role === "SuperAdmin") return;
    if (principal.role === "Instructor" && visibility !== "congregation" && cellGroupId) {
      const led = await maybeOne(
        c,
        `SELECT 1 FROM leader_assignments WHERE leader_user_id = $1 AND cell_group_id = $2`,
        [principal.userId, cellGroupId],
      );
      if (led) return;
    }
    throw new ApiError("FORBIDDEN_SCOPE", "Not permitted to create events in this scope");
  }

  static readonly UpdateSeries = z.preprocess(normalizeSeriesInput, CalendarService.SeriesShape.partial());

  async updateSeries(principal: Principal, seriesId: string, input: z.infer<typeof CalendarService.UpdateSeries>): Promise<unknown> {
    if (input.rrule) validateRrule(input.rrule);
    return tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      const fields: Record<string, unknown> = {
        title: input.title,
        description: input.description,
        location: input.location,
        timezone: input.timezone,
        dtstart_local: input.dtstart_local,
        duration_min: input.duration_min,
        rrule: input.rrule,
        visibility: input.visibility,
        status: input.status,
      };
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (keys.length > 0) {
        const sets = keys.map((k, i) => `${k} = $${i + 2}`);
        await c.query(`UPDATE event_series SET ${sets.join(", ")} WHERE series_id = $1`, [seriesId, ...keys.map((k) => fields[k])]);
      }
      await enqueueOutbox(c, "calendar.materialize", { series_id: seriesId });
      await audit(c, principal.userId, "calendar.series_updated", "event_series", seriesId, { fields: keys });
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [seriesId]);
    });
  }

  static readonly Exception = z
    .object({
      original_start_at: z.string().min(1),
      is_cancelled: z.boolean().default(false),
      new_start_at: z.string().nullable().optional(),
      new_end_at: z.string().nullable().optional(),
      note: z.string().max(255).nullable().optional(),
    })
    .strict();

  async addException(principal: Principal, seriesId: string, input: z.infer<typeof CalendarService.Exception>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const s = await maybeOne(c, `SELECT 1 FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      const row = await one(
        c,
        `INSERT INTO event_exceptions (series_id, original_start_at, is_cancelled, new_start_at, new_end_at, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (series_id, original_start_at) DO UPDATE
           SET is_cancelled = EXCLUDED.is_cancelled, new_start_at = EXCLUDED.new_start_at,
               new_end_at = EXCLUDED.new_end_at, note = EXCLUDED.note
         RETURNING *`,
        [seriesId, input.original_start_at, input.is_cancelled, input.new_start_at ?? null, input.new_end_at ?? null, input.note ?? null],
      );
      await audit(c, principal.userId, "calendar.exception", "event_series", seriesId, { original: input.original_start_at });

      // Notify members who RSVP'd "going" to the matching materialized occurrence
      // (cancellation or reschedule, Contract Matrix B2). Best-effort: notification
      // failures must not roll back the exception itself.
      const occurrence = await maybeOne<{ event_id: string; occurs_at: string }>(
        c,
        `SELECT event_id, occurs_at FROM events WHERE series_id = $1 AND occurrence_start = $2`,
        [seriesId, input.original_start_at],
      );
      if (occurrence) {
        const goers = await many<{ user_id: string }>(
          c,
          `SELECT user_id FROM event_rsvps WHERE event_id = $1 AND status = 'going'`,
          [occurrence.event_id],
        );
        const template = input.is_cancelled ? "event_cancelled" : "event_rescheduled";
        for (const g of goers) {
          try {
            await this.notifications.schedule({
              userId: g.user_id,
              channel: "push",
              template,
              payload: {
                event_id: occurrence.event_id,
                original_start_at: input.original_start_at,
                new_start_at: input.new_start_at ?? null,
                note: input.note ?? null,
              },
            });
          } catch {
            // best-effort
          }
        }
      }
      return row;
    });
  }

  async deleteSeries(principal: Principal, seriesId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`UPDATE event_series SET deleted_at = now() WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Series not found");
      await audit(c, principal.userId, "calendar.series_deleted", "event_series", seriesId, {});
      return { deleted: true };
    });
  }

  // ---------------- Materializer (worker) ----------------

  /** Realize occurrences within [now, now+horizon] into `events` (idempotent). */
  async materialize(seriesId: string): Promise<{ created: number }> {
    const s = await maybeOne<SeriesRow>(
      this.pool,
      `SELECT series_id, congregation_id, cell_group_id, title, description, location, timezone,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
              duration_min, rrule, visibility,
              rsvp_enabled, qr_enabled, reminders_enabled, checkin_opens_min_before
         FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
      [seriesId],
    );
    if (!s) return { created: 0 };
    const now = new Date();
    const horizon = new Date(now.getTime() + this.horizonDays * 86_400_000);
    const occ = expandOccurrences(s, now, horizon, this.maxInstances);
    const exCancelled = new Set(
      (await many<{ original_start_at: string }>(this.pool, `SELECT original_start_at FROM event_exceptions WHERE series_id = $1 AND is_cancelled`, [seriesId]))
        .map((e) => new Date(e.original_start_at).getTime()),
    );
    let created = 0;
    for (const o of occ) {
      if (exCancelled.has(new Date(o.start_at).getTime())) continue;
      const eventId = occurrenceId(seriesId, o.start_at);
      // Check-in window: opens N minutes before the occurrence when configured.
      const opensAt =
        s.checkin_opens_min_before == null
          ? null
          : new Date(new Date(o.start_at).getTime() - s.checkin_opens_min_before * 60_000).toISOString();
      const r = await this.pool.query(
        `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret, series_id, occurrence_start,
                             rsvp_enabled, qr_enabled, checkin_opens_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (series_id, occurrence_start) DO NOTHING`,
        [
          eventId,
          s.congregation_id,
          s.cell_group_id,
          s.title,
          o.start_at,
          randomBytes(24).toString("hex"),
          seriesId,
          o.start_at,
          s.rsvp_enabled ?? true,
          s.qr_enabled ?? true,
          opensAt,
        ],
      );
      created += r.rowCount ?? 0;
    }
    return { created };
  }

  // ---------------- RSVP ----------------

  static readonly Rsvp = z.object({
    status: z.enum(["going", "maybe", "declined"]),
    client_mutation_id: z.string().uuid().optional(),
  });

  async setRsvp(
    userId: string,
    eventId: string,
    input: { status: "going" | "maybe" | "declined"; client_mutation_id?: string | undefined },
    c: Queryable = this.pool,
  ): Promise<{ duplicate: boolean; status: string }> {
    if (input.client_mutation_id) {
      const dup = await maybeOne<{ status: string }>(c, `SELECT status FROM event_rsvps WHERE client_mutation_id = $1`, [input.client_mutation_id]);
      if (dup) return { duplicate: true, status: dup.status };
    }
    const ev = await maybeOne<{ event_id: string; occurs_at: string; rsvp_enabled: boolean; reminders: boolean }>(
      c,
      `SELECT e.event_id, e.occurs_at, e.rsvp_enabled,
              COALESCE(es.reminders_enabled, TRUE) AS reminders
         FROM events e LEFT JOIN event_series es ON es.series_id = e.series_id
        WHERE e.event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    if (!ev.rsvp_enabled) throw new ApiError("UNPROCESSABLE", "RSVP is not enabled for this event");
    const row = await one<{ rsvp_id: string; status: string }>(
      c,
      `INSERT INTO event_rsvps (event_id, user_id, status, client_mutation_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET status = EXCLUDED.status, client_mutation_id = COALESCE(EXCLUDED.client_mutation_id, event_rsvps.client_mutation_id), updated_at = now()
       RETURNING rsvp_id, status`,
      [eventId, userId, input.status, input.client_mutation_id ?? null],
    );
    await recordChange(c, "event_rsvps", row.rsvp_id, userId, "upsert");

    // Reminders at T-24h and T-1h for a future "going" RSVP (quiet-hours aware;
    // skip the 24h one when the event is closer than that).
    if (input.status === "going" && ev.reminders) {
      const startMs = new Date(ev.occurs_at).getTime();
      const offsets = [24 * 60, 60].filter((min) => startMs - min * 60_000 > Date.now());
      for (const min of offsets) {
        await this.notifications.schedule({
          userId,
          channel: "push",
          template: min >= 1440 ? "event_reminder_24h" : "event_reminder_1h",
          payload: { event_id: eventId, occurs_at: ev.occurs_at },
          at: startMs - min * 60_000,
        });
      }
    }
    return { duplicate: false, status: row.status };
  }

  /** The member's RSVPs for upcoming events ("My RSVPs", Contract Matrix B2). */
  async myRsvps(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT r.rsvp_id, r.status::text, r.updated_at,
              e.event_id, e.title, e.occurs_at, e.cell_group_id
         FROM event_rsvps r JOIN events e ON e.event_id = r.event_id
        WHERE r.user_id = $1 AND e.occurs_at >= now() - interval '1 day'
        ORDER BY e.occurs_at ASC
        LIMIT 100`,
      [userId],
    );
  }

  async getEvent(userId: string, eventId: string): Promise<unknown> {
    const ev = await maybeOne<{ event_id: string; title: string; occurs_at: string; congregation_id: string }>(
      this.pool,
      `SELECT event_id, title, occurs_at, congregation_id FROM events WHERE event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    const counts = await many<{ status: string; n: number }>(
      this.pool,
      `SELECT status, COUNT(*)::int AS n FROM event_rsvps WHERE event_id = $1 GROUP BY status`,
      [eventId],
    );
    const mine = await maybeOne<{ status: string }>(this.pool, `SELECT status FROM event_rsvps WHERE event_id = $1 AND user_id = $2`, [eventId, userId]);
    return {
      event_id: ev.event_id,
      title: ev.title,
      occurs_at: ev.occurs_at,
      rsvp_counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
      my_rsvp: mine?.status ?? null,
    };
  }

  // ---------------- Leader: RSVP roster (Events page) ----------------

  /**
   * The RSVP roster for one materialized occurrence (Events page). Resolves the
   * occurrence exactly like the attendance roster — by its materialized
   * `event_id` (= occurrenceId(series_id, start)) — then scope-checks the
   * occurrence's cell (Admin+ pass; an Instructor must lead that cell, else
   * 403 FORBIDDEN_SCOPE) before returning RSVPs.
   *
   * Returns each rsvp row {user_id, full_name, response, cell_name, responded_at}
   * grouped under its response bucket, plus a count per response. A "no_response"
   * bucket lists cell members (for a cell-scoped occurrence) who have no rsvp row
   * — cheap to derive from the occurrence's own cell. For congregation-wide
   * occurrences (no cell) no_response is left empty (deriving it would mean
   * scanning the whole congregation), and `no_response_scope` flags that.
   */
  async rsvpRoster(principal: Principal, eventId: string): Promise<Record<string, unknown>> {
    const ev = await maybeOne<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT cell_group_id FROM events WHERE event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    await assertCellInScope(this.pool, principal, ev.cell_group_id ?? "");

    const rsvps = await many<{
      user_id: string;
      full_name: string;
      response: string;
      cell_name: string | null;
      responded_at: string;
    }>(
      this.pool,
      `SELECT r.user_id, u.full_name, r.status::text AS response,
              cg.name AS cell_name, r.updated_at AS responded_at
         FROM event_rsvps r
         JOIN users u ON u.user_id = r.user_id
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
        WHERE r.event_id = $1
        ORDER BY u.full_name`,
      [eventId],
    );

    const buckets: Record<string, typeof rsvps> = { going: [], maybe: [], declined: [], no_response: [] };
    for (const r of rsvps) (buckets[r.response] ??= []).push(r);

    // no_response: cell members (for a cell-scoped occurrence) with no rsvp row.
    // Cheap — scoped to the occurrence's own cell. Skipped for congregation-wide.
    if (ev.cell_group_id) {
      const noResponse = await many<{ user_id: string; full_name: string; cell_name: string | null }>(
        this.pool,
        `SELECT u.user_id, u.full_name, cg.name AS cell_name
           FROM users u
           LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
          WHERE u.cell_group_id = $1 AND u.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = $2 AND r.user_id = u.user_id)
          ORDER BY u.full_name`,
        [ev.cell_group_id, eventId],
      );
      buckets.no_response = noResponse.map((m) => ({ ...m, response: "no_response", responded_at: "" }));
    }

    return {
      event_id: eventId,
      buckets,
      counts: {
        going: buckets.going!.length,
        maybe: buckets.maybe!.length,
        declined: buckets.declined!.length,
        no_response: buckets.no_response!.length,
      },
      no_response_scope: ev.cell_group_id ? "cell" : "none",
    };
  }

  // ---------------- Leader: series pause / resume (Events page) ----------------

  /** Pause a series so it stops projecting/materializing future occurrences (audited). */
  async pauseSeries(principal: Principal, seriesId: string): Promise<unknown> {
    return this.setPaused(principal, seriesId, true);
  }

  /** Resume a paused series, restoring normal projection (audited). */
  async resumeSeries(principal: Principal, seriesId: string): Promise<unknown> {
    return this.setPaused(principal, seriesId, false);
  }

  private async setPaused(principal: Principal, seriesId: string, paused: boolean): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
        [seriesId],
      );
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      await c.query(`UPDATE event_series SET is_paused = $2 WHERE series_id = $1`, [seriesId, paused]);
      await audit(c, principal.userId, paused ? "calendar.series_paused" : "calendar.series_resumed", "event_series", seriesId, {});
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [seriesId]);
    });
  }

  // ---------------- NLP quick-add (chrono-node) ----------------

  parse(text: string, timezone: string): { title: string; start_at: string | null; end_at: string | null; confidence: number } {
    const ref = DateTime.now().setZone(DateTime.now().setZone(timezone).isValid ? timezone : "UTC").toJSDate();
    const results = chrono.parse(text, ref, { forwardDate: true });
    const first = results[0];
    if (!first) return { title: text.trim(), start_at: null, end_at: null, confidence: 0 };
    const start = first.start?.date() ?? null;
    const end = first.end?.date() ?? null;
    const title = text.replace(first.text, "").replace(/\s{2,}/g, " ").trim() || text.trim();
    // Coarse confidence: more parsed components → higher.
    const known = first.start ? Object.keys((first.start as unknown as { knownValues: object }).knownValues ?? {}).length : 0;
    return {
      title,
      start_at: start ? start.toISOString() : null,
      end_at: end ? end.toISOString() : null,
      confidence: Math.min(1, known / 4),
    };
  }
}

/** Deterministic, stable occurrence/event id so attendance + RSVP key cleanly.
 *  (series_id 36 + ':' + ISO 24 = 61 chars ≤ events.event_id VARCHAR(100).) */
export function occurrenceId(seriesId: string, startIso: string): string {
  return `${seriesId}:${new Date(startIso).toISOString()}`;
}

export { randomUUID };
export type { Occurrence };
