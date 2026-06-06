// Gamification service (Features v2 §G). Faithfulness, not competition: awards
// derive ONLY from verified server signals; clients never originate them; there
// are NO public individual leaderboards. Cell encouragement is aggregate-only
// with a k-anonymity floor. Metrics stay separate from ministry (§1.1).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";

const K_ANON_FLOOR = 3; // suppress cell aggregates below this many active members (§G.4)

// Registered rule kinds — the interpreter only runs these; no arbitrary expressions.
const CriteriaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("module_count"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("level_reached"), level: z.number().int().positive() }),
  z.object({ kind: z.literal("streak_days"), days: z.number().int().positive() }),
  z.object({ kind: z.literal("attendance_count"), count: z.number().int().positive() }),
]);
type Criteria = z.infer<typeof CriteriaSchema>;

interface MemberStats {
  modules_completed: number;
  current_level: number;
  streak_days: number;
  attendance_count: number;
}

function satisfies(criteria: Criteria, s: MemberStats): boolean {
  switch (criteria.kind) {
    case "module_count":
      return s.modules_completed >= criteria.count;
    case "level_reached":
      return s.current_level >= criteria.level;
    case "streak_days":
      return s.streak_days >= criteria.days;
    case "attendance_count":
      return s.attendance_count >= criteria.count;
  }
}

export class GamificationService {
  constructor(private readonly pool: Pool) {}

  private async stats(c: Queryable, userId: string): Promise<MemberStats> {
    const row = await one<{ modules_completed: number; current_level: number; attendance_count: number }>(
      c,
      `SELECT
         (SELECT COUNT(*)::int FROM module_progress mp JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
            WHERE e.user_id = $1 AND mp.is_completed) AS modules_completed,
         COALESCE((SELECT current_level FROM enrollments WHERE user_id = $1), 1) AS current_level,
         (SELECT COUNT(*)::int FROM attendance_logs WHERE user_id = $1) AS attendance_count`,
      [userId],
    );
    const streak = await maybeOne<{ current_streak_days: number }>(c, `SELECT current_streak_days FROM user_streaks WHERE user_id = $1`, [userId]);
    return { ...row, streak_days: streak?.current_streak_days ?? 0 };
  }

  /** Evaluate the catalog against a member's verified stats; award any newly-earned
   *  badges (dedupe-keyed). Idempotent + at-least-once safe. */
  async evaluateForUser(userId: string): Promise<{ awarded: string[] }> {
    return tx(this.pool, async (c) => {
      const s = await this.stats(c, userId);
      const badges = await many<{ badge_id: string; code: string; criteria: Criteria }>(
        c,
        `SELECT badge_id, code, criteria FROM badges WHERE is_active
           AND badge_id NOT IN (SELECT badge_id FROM user_badges WHERE user_id = $1 AND revoked_at IS NULL)`,
        [userId],
      );
      const awarded: string[] = [];
      for (const b of badges) {
        const parsed = CriteriaSchema.safeParse(b.criteria);
        if (!parsed.success || !satisfies(parsed.data, s)) continue;
        // Dedupe gate: one award per (user, code) ever.
        const ins = await c.query(
          `INSERT INTO gamification_events (user_id, kind, ref, dedupe_key)
           VALUES ($1,'badge_awarded',$2,$3) ON CONFLICT (dedupe_key) DO NOTHING`,
          [userId, JSON.stringify({ code: b.code }), `badge:${userId}:${b.code}`],
        );
        if ((ins.rowCount ?? 0) === 0) continue; // already awarded concurrently
        await c.query(
          `INSERT INTO user_badges (user_id, badge_id, source) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, badge_id) DO NOTHING`,
          [userId, b.badge_id, JSON.stringify({ event: "evaluate", stats: s })],
        );
        await recordChange(c, "achievements", b.badge_id, userId, "upsert");
        await enqueueOutbox(c, "notification.badge_awarded", { user_id: userId, code: b.code });
        awarded.push(b.code);
      }
      return { awarded };
    });
  }

  /** Recompute the member's streak from verified interaction events, in their TZ. */
  async computeStreak(userId: string): Promise<{ current: number; longest: number }> {
    const u = await one<{ timezone: string }>(this.pool, `SELECT COALESCE(timezone,'Africa/Nairobi') AS timezone FROM users WHERE user_id = $1`, [userId]);
    const rows = await many<{ d: string }>(
      this.pool,
      `SELECT DISTINCT (occurred_at AT TIME ZONE $2)::date::text AS d
         FROM interaction_events WHERE user_id = $1
          AND occurred_at >= (CURRENT_DATE - INTERVAL '400 days')
        ORDER BY d DESC`,
      [userId, u.timezone],
    );
    const days = rows.map((r) => r.d);
    const { current, longest } = streakFromDates(days, todayInZone(u.timezone));
    await tx(this.pool, async (c) => {
      await c.query(
        `INSERT INTO user_streaks (user_id, current_streak_days, longest_streak_days, last_active_date, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (user_id) DO UPDATE SET
           current_streak_days = EXCLUDED.current_streak_days,
           longest_streak_days = GREATEST(user_streaks.longest_streak_days, EXCLUDED.longest_streak_days),
           last_active_date = EXCLUDED.last_active_date, updated_at = now()`,
        [userId, current, longest, days[0] ?? null],
      );
      await recordChange(c, "achievements", userId, userId, "upsert");
    });
    return { current, longest };
  }

  /** Nightly streak recompute for recently-active members (piggybacks §G.3). */
  async recomputeActiveStreaks(): Promise<{ updated: number }> {
    const users = await many<{ user_id: string }>(
      this.pool,
      `SELECT DISTINCT user_id FROM interaction_events WHERE occurred_at >= (CURRENT_DATE - INTERVAL '2 days')`,
    );
    for (const u of users) await this.computeStreak(u.user_id);
    return { updated: users.length };
  }

  // ---------------- Reads ----------------

  async myAchievements(userId: string): Promise<unknown> {
    const badges = await many(
      this.pool,
      `SELECT b.code, b.name, b.description, b.category, b.icon_key, ub.awarded_at
         FROM user_badges ub JOIN badges b ON b.badge_id = ub.badge_id
        WHERE ub.user_id = $1 AND ub.revoked_at IS NULL ORDER BY ub.awarded_at DESC`,
      [userId],
    );
    const streak = (await maybeOne<{ current_streak_days: number; longest_streak_days: number }>(
      this.pool,
      `SELECT current_streak_days, longest_streak_days FROM user_streaks WHERE user_id = $1`,
      [userId],
    )) ?? { current_streak_days: 0, longest_streak_days: 0 };
    return { badges, streak: { current: streak.current_streak_days, longest: streak.longest_streak_days } };
  }

  listBadges(): Promise<unknown[]> {
    return many(this.pool, `SELECT code, name, description, category, icon_key FROM badges WHERE is_active ORDER BY category, code`);
  }

  /** Aggregate-only cell encouragement; suppressed below the k-anonymity floor. */
  async cellMilestones(principal: Principal, cellId: string): Promise<unknown> {
    await assertCellInScope(this.pool, principal, cellId);
    const active = await one<{ n: number }>(this.pool, `SELECT COUNT(*)::int AS n FROM users WHERE cell_group_id = $1 AND deleted_at IS NULL`, [cellId]);
    if (active.n < K_ANON_FLOOR) {
      return { suppressed: true, reason: `Aggregates hidden for cells with < ${K_ANON_FLOOR} members` };
    }
    const agg = await one<{ total_badges: number; collective_streak_days: number }>(
      this.pool,
      `SELECT
         (SELECT COUNT(*)::int FROM user_badges ub JOIN users u ON u.user_id = ub.user_id
            WHERE u.cell_group_id = $1 AND ub.revoked_at IS NULL) AS total_badges,
         (SELECT COALESCE(SUM(us.current_streak_days),0)::int FROM user_streaks us JOIN users u ON u.user_id = us.user_id
            WHERE u.cell_group_id = $1) AS collective_streak_days`,
      [cellId],
    );
    return { suppressed: false, active_members: active.n, ...agg };
  }

  /** Leader-scoped pastoral view of one member's achievements. */
  async memberAchievements(principal: Principal, userId: string): Promise<unknown> {
    const u = await maybeOne<{ cell_group_id: string | null }>(this.pool, `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
    if (!u) throw new ApiError("NOT_FOUND", "Member not found");
    await assertCellInScope(this.pool, principal, u.cell_group_id ?? "");
    return this.myAchievements(userId);
  }

  // ---------------- Admin catalog ----------------

  static readonly BadgeInput = z
    .object({
      code: z.string().min(1).max(60),
      name: z.string().min(1).max(120),
      description: z.string().min(1),
      category: z.enum(["journey", "consistency", "community", "service"]),
      icon_key: z.string().max(255).nullable().optional(),
      criteria: CriteriaSchema, // validated against the registered rule schema
    })
    .strict();

  async createBadge(adminId: string, input: z.infer<typeof GamificationService.BadgeInput>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      let row;
      try {
        row = await one(
          c,
          `INSERT INTO badges (code, name, description, category, icon_key, criteria)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [input.code, input.name, input.description, input.category, input.icon_key ?? null, JSON.stringify(input.criteria)],
        );
      } catch (e) {
        if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "23505") {
          throw new ApiError("CONFLICT", "A badge with that code already exists");
        }
        throw e;
      }
      await audit(c, adminId, "badge.created", "badges", input.code, {});
      return row;
    });
  }

  async deactivateBadge(adminId: string, code: string): Promise<{ deactivated: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`UPDATE badges SET is_active = FALSE WHERE code = $1`, [code]);
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Badge not found");
      // Deactivation never revokes already-earned badges (§G.2).
      await audit(c, adminId, "badge.deactivated", "badges", code, {});
      return { deactivated: true };
    });
  }

  static readonly Revoke = z.object({ reason: z.string().min(1).max(500) }).strict();

  /** Data-correction revocation — the only manual award path, audited with a reason. */
  async revokeBadge(adminId: string, userId: string, code: string, reason: string): Promise<{ revoked: boolean }> {
    return tx(this.pool, async (c) => {
      const badge = await maybeOne<{ badge_id: string }>(c, `SELECT badge_id FROM badges WHERE code = $1`, [code]);
      if (!badge) throw new ApiError("NOT_FOUND", "Badge not found");
      const r = await c.query(
        `UPDATE user_badges SET revoked_at = now() WHERE user_id = $1 AND badge_id = $2 AND revoked_at IS NULL`,
        [userId, badge.badge_id],
      );
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Member does not hold that badge");
      await recordChange(c, "achievements", badge.badge_id, userId, "delete");
      await audit(c, adminId, "badge.revoked", "user_badges", userId, { code, reason });
      return { revoked: true };
    });
  }
}

// ---- pure streak math (exported for tests) ----
export function streakFromDates(descDates: string[], today: string): { current: number; longest: number } {
  const set = new Set(descDates);
  // current: consecutive days ending today or yesterday.
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (set.has(cursor)) {
    while (set.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }
  // longest: scan ascending for the longest run of consecutive days.
  const asc = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of asc) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  return { current, longest: Math.max(longest, current) };
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function todayInZone(zone: string): string {
  // Date in the given IANA zone as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
