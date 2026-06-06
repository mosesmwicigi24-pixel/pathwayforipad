// Engagement (Eᵢ) pipeline (spec §1.8, §2.5). The authoritative recompute runs
// the §2.5 aggregation and upserts a per-member snapshot into engagement_scores;
// the cohort view then reads that snapshot with a single indexed query (§1.3).
// Bands (thriving/steady/watch/at_risk) are stored alongside the raw score so the
// portal filters without re-deriving thresholds.
//
// The aggregation below mirrors src/db/engagement-aggregation.sql verbatim
// (§2.5) — embedded here so the recompute needs no filesystem access at runtime.
// Keep the two in lockstep.
import type { Pool } from "pg";
import { ENGAGEMENT } from "@nuru/shared";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";

// Cᵢ denominator: the LIVE count of published modules; falls back to the
// documented constant only when there are none (e.g. a minimal test DB) (§1.8).
const PUBLISHED_MODULE_COUNT = `COALESCE(NULLIF((SELECT count(*) FROM modules WHERE status = 'published'), 0), ${ENGAGEMENT.CURRICULUM_MODULE_COUNT})`;

// §2.5 reference query → (user_id, cell_group_id, h_score, c_score, a_score, e_score).
const AGGREGATION = `
WITH hab AS (
  SELECT user_id, LEAST(1.0, COUNT(DISTINCT date_trunc('day', occurred_at)) / 20.0) AS h
    FROM interaction_events
   WHERE occurred_at >= (CURRENT_DATE - INTERVAL '30 days')
   GROUP BY user_id),
cur AS (
  SELECT e.user_id, LEAST(1.0, COUNT(*) FILTER (WHERE mp.is_completed)::numeric / ${PUBLISHED_MODULE_COUNT}) AS c
    FROM enrollments e JOIN module_progress mp USING (enrollment_id) GROUP BY e.user_id),
att AS (
  SELECT u.user_id, LEAST(1.0, COUNT(al.*)::numeric / GREATEST(cg.meeting_cadence, 1)) AS a
    FROM users u
    LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
    LEFT JOIN attendance_logs al ON al.user_id = u.user_id
      AND al.checked_in_at >= (CURRENT_DATE - INTERVAL '30 days')
   GROUP BY u.user_id, cg.meeting_cadence)
SELECT u.user_id, u.cell_group_id,
       COALESCE(hab.h, 0) AS h_score, COALESCE(cur.c, 0) AS c_score, COALESCE(att.a, 0) AS a_score,
       ROUND(0.40 * COALESCE(hab.h, 0) + 0.35 * COALESCE(cur.c, 0) + 0.25 * COALESCE(att.a, 0), 3) AS e_score
  FROM users u
  LEFT JOIN hab ON hab.user_id = u.user_id
  LEFT JOIN cur ON cur.user_id = u.user_id
  LEFT JOIN att ON att.user_id = u.user_id
 WHERE u.deleted_at IS NULL AND u.role = 'Student'`;

// Banding thresholds (§1.8) applied in SQL so the snapshot carries the band.
const BAND_CASE = `(CASE
    WHEN e_score >= 0.75 THEN 'thriving'
    WHEN e_score >= 0.55 THEN 'steady'
    WHEN e_score >= 0.40 THEN 'watch'
    ELSE 'at_risk' END)::engagement_band`;

const UPSERT = `
  INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
  SELECT user_id, cell_group_id, h_score, c_score, a_score, e_score, ${BAND_CASE}, CURRENT_DATE
    FROM ( ${AGGREGATION} ) agg`;

const ON_CONFLICT = `
  ON CONFLICT (user_id) DO UPDATE SET
    cell_group_id = EXCLUDED.cell_group_id, h_score = EXCLUDED.h_score, c_score = EXCLUDED.c_score,
    a_score = EXCLUDED.a_score, e_score = EXCLUDED.e_score, band = EXCLUDED.band,
    window_end = EXCLUDED.window_end, computed_at = now()`;

interface ScoreRow {
  user_id: string;
  full_name?: string;
  h_score: string;
  c_score: string;
  a_score: string;
  e_score: string;
  band: string;
  window_end: string;
  computed_at: string;
}

function toBreakdown(r: ScoreRow & { last_active_days_ago?: number | null }): Record<string, unknown> {
  return {
    user_id: r.user_id,
    ...(r.full_name !== undefined ? { full_name: r.full_name } : {}),
    h_score: Number(r.h_score),
    c_score: Number(r.c_score),
    a_score: Number(r.a_score),
    e_score: Number(r.e_score),
    band: r.band,
    window_end: r.window_end,
    computed_at: r.computed_at,
    ...(r.last_active_days_ago !== undefined
      ? { last_active_days_ago: r.last_active_days_ago === null ? null : Number(r.last_active_days_ago) }
      : {}),
  };
}

export class EngagementService {
  constructor(
    private readonly pool: Pool,
    // Reads (cohort/member) go to the replica (§1.6); writes to the primary.
    private readonly replica: Pool = pool,
  ) {}

  /** Nightly authoritative recompute for every active student (§1.8). */
  async recomputeAll(): Promise<{ updated: number }> {
    const res = await this.pool.query(`${UPSERT} ${ON_CONFLICT}`);
    return { updated: res.rowCount ?? 0 };
  }

  /** Entry point the nightly worker / outbox calls (§1.8). */
  runRecompute(): Promise<{ updated: number }> {
    return this.recomputeAll();
  }

  /** Incremental single-member recompute (driven by the outbox on high-signal events). */
  async recomputeOne(userId: string): Promise<void> {
    await this.pool.query(`${UPSERT} WHERE agg.user_id = $1 ${ON_CONFLICT}`, [userId]);
  }

  /**
   * Cohort table: a cell's members, lowest engagement first (§1.3), cursor-paginated
   * (§3.1). Scoped (§5.4) and read from the replica. Optional ?band= filter.
   */
  async cohort(
    principal: Principal,
    cellGroupId: string,
    opts: { band?: string; limit?: number; cursor?: string },
  ): Promise<{ data: unknown[]; next_cursor: string | null }> {
    await assertCellInScope(this.replica, principal, cellGroupId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const params: unknown[] = [cellGroupId];
    let where = `WHERE es.cell_group_id = $1`;
    if (opts.band) {
      params.push(opts.band);
      where += ` AND es.band = $${params.length}::engagement_band`;
    }
    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.e, cursor.u);
      // Stable keyset pagination on (e_score, user_id) ascending.
      where += ` AND (es.e_score, es.user_id) > ($${params.length - 1}::numeric, $${params.length}::uuid)`;
    }
    params.push(limit + 1); // fetch one extra to detect a next page

    const rows = await many<CohortRow>(
      this.replica,
      `SELECT es.user_id, u.full_name, es.h_score, es.c_score, es.a_score, es.e_score,
              es.band, es.window_end, es.computed_at,
              (SELECT (CURRENT_DATE - MAX(ie.occurred_at)::date)
                 FROM interaction_events ie WHERE ie.user_id = es.user_id) AS last_active_days_ago
         FROM engagement_scores es JOIN users u ON u.user_id = es.user_id
         ${where}
        ORDER BY es.e_score ASC, es.user_id ASC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const next_cursor = hasMore && last ? encodeCursor(last.e_score, last.user_id) : null;
    return { data: page.map(toBreakdown), next_cursor };
  }

  /** A member's Hᵢ/Cᵢ/Aᵢ breakdown + recent signal history (§3.3). Scoped (§5.4). */
  async member(principal: Principal, userId: string): Promise<unknown> {
    const u = await maybeOne<{ cell_group_id: string | null }>(
      this.replica,
      `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!u) throw new ApiError("NOT_FOUND", "Member not found");
    await assertCellInScope(this.replica, principal, u.cell_group_id ?? "");
    const score = await maybeOne<ScoreRow>(
      this.replica,
      `SELECT user_id, h_score, c_score, a_score, e_score, band, window_end, computed_at
         FROM engagement_scores WHERE user_id = $1`,
      [userId],
    );
    if (!score) throw new ApiError("NOT_FOUND", "No engagement snapshot yet for this member");
    const recentSignals = await many(
      this.replica,
      `SELECT kind, occurred_at FROM interaction_events WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
      [userId],
    );
    return { ...toBreakdown(score), recent_signals: recentSignals };
  }
}

interface CohortRow extends ScoreRow {
  last_active_days_ago: number | null;
}

function encodeCursor(eScore: string, userId: string): string {
  return Buffer.from(`${eScore}|${userId}`, "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { e: string; u: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.lastIndexOf("|");
  if (sep <= 0) return null;
  return { e: decoded.slice(0, sep), u: decoded.slice(sep + 1) };
}
