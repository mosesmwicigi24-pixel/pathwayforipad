// Home feed (server-driven UI). The server decides WHAT to surface per member —
// the client only renders the slot it's handed, so the look & feel is identical
// for everyone while the content is tailored (§1.1 server-authoritative). This
// first slice is the Next-Best-Action hero: a rule-based engine that scores a set
// of candidate prompts against the member's real signals and returns the single
// highest-priority one. Deterministic + explainable (pastoral, never shaming);
// the ranking can later grow into segments / bandits / ML behind this same shape.
import type { Pool } from "pg";
import { one, maybeOne } from "../../db/db.js";
import { ScoresService, type ScoreBreakdown } from "../scores/service.js";

const TZ = "Africa/Nairobi";

export type HomeRoute =
  | "pathway"
  | "module"
  | "prayer"
  | "memoryVerses"
  | "devotional"
  | "events"
  | "none";

export interface NextAction {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  route: HomeRoute;
  params?: { moduleId?: string };
  accent: "gold" | "navy" | "success" | "steady";
  priority: number; // why this won (for transparency / debugging)
}

interface Ctx {
  current_level: number | null;
  streak: number;
  last_active_date: string | null;
  did_prayer: boolean;
  did_word: boolean;
  did_reflection: boolean;
  any_today: boolean;
}

export class HomeService {
  constructor(
    private readonly pool: Pool,
    private readonly scores = new ScoresService(pool),
  ) {}

  /** The single most valuable next step for this member right now (or null). */
  async nextAction(userId: string): Promise<{ action: NextAction | null }> {
    const scores = await this.scores.all(userId);
    const ctx = await one<Ctx>(
      this.pool,
      `WITH enr AS (SELECT current_level FROM enrollments WHERE user_id = $1 LIMIT 1),
            streak AS (SELECT current_streak_days, last_active_date FROM user_streaks WHERE user_id = $1),
            today AS (
              SELECT bool_or(kind = 'prayer') AS prayer,
                     bool_or(kind = 'word') AS word,
                     bool_or(kind = 'reflection') AS reflection,
                     count(*) > 0 AS any_today
                FROM interaction_events
               WHERE user_id = $1
                 AND (occurred_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
            )
       SELECT (SELECT current_level FROM enr) AS current_level,
              COALESCE((SELECT current_streak_days FROM streak), 0) AS streak,
              (SELECT last_active_date FROM streak) AS last_active_date,
              COALESCE((SELECT prayer FROM today), false) AS did_prayer,
              COALESCE((SELECT word FROM today), false) AS did_word,
              COALESCE((SELECT reflection FROM today), false) AS did_reflection,
              COALESCE((SELECT any_today FROM today), false) AS any_today`,
      [userId, TZ],
    );

    // The next unlocked-ish module: lowest unfinished published module in the
    // member's current level (gating still enforced when they actually open it).
    const nextModule =
      ctx.current_level == null
        ? null
        : await maybeOne<{ module_id: string; title: string }>(
            this.pool,
            `SELECT m.module_id, m.title
               FROM modules m
              WHERE m.level_number = $2 AND m.status = 'published'
                AND NOT EXISTS (
                  SELECT 1 FROM module_progress mp
                    JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
                   WHERE e.user_id = $1 AND mp.module_id = m.module_id AND mp.is_completed)
              ORDER BY m.module_sequence_number
              LIMIT 1`,
            [userId, ctx.current_level],
          );

    const modulesCompleted = Number((scores.curriculum as ScoreBreakdown).detail.modules_completed ?? 0);
    const lapsedDays = daysSince(ctx.last_active_date);

    const candidates: NextAction[] = [];

    // Brand-new member — point at the very first step.
    if (modulesCompleted === 0 && !ctx.any_today) {
      candidates.push({
        id: "start",
        title: "Begin your journey",
        body: "Take your first step on the pathway today.",
        cta_label: "Start learning",
        route: nextModule ? "module" : "pathway",
        ...(nextModule ? { params: { moduleId: nextModule.module_id } } : {}),
        accent: "gold",
        priority: 95,
      });
    }

    // About to lose a streak today.
    if (ctx.streak >= 2 && !ctx.any_today) {
      candidates.push({
        id: "streak_save",
        title: `Keep your ${ctx.streak}-day streak alive`,
        body: "A few minutes today keeps your rhythm going.",
        cta_label: "Open today's devotional",
        route: "devotional",
        accent: "gold",
        priority: 90,
      });
    }

    // Returning after a lapse.
    if (lapsedDays != null && lapsedDays >= 7 && modulesCompleted > 0) {
      candidates.push({
        id: "welcome_back",
        title: "Welcome back",
        body: "Pick up right where you left off — grace for today's step.",
        cta_label: "Continue",
        route: nextModule ? "module" : "pathway",
        ...(nextModule ? { params: { moduleId: nextModule.module_id } } : {}),
        accent: "navy",
        priority: 80,
      });
    }

    // Resume the next lesson.
    if (nextModule && modulesCompleted > 0) {
      candidates.push({
        id: "resume_lesson",
        title: `Continue: ${nextModule.title}`,
        body: "Your next lesson is ready.",
        cta_label: "Resume lesson",
        route: "module",
        params: { moduleId: nextModule.module_id },
        accent: "navy",
        priority: 65,
      });
    }

    // One day from a streak milestone (encouragement when already active today).
    if (ctx.any_today && [6, 13, 29, 49, 99].includes(ctx.streak)) {
      candidates.push({
        id: "streak_milestone",
        title: `One day from a ${ctx.streak + 1}-day streak!`,
        body: "Come back tomorrow to reach it.",
        cta_label: "See your progress",
        route: "pathway",
        accent: "success",
        priority: 60,
      });
    }

    // Today's rhythm isn't finished — nudge the first missing discipline.
    const missing: Array<{ key: string; label: string; route: HomeRoute }> = [];
    if (!ctx.did_prayer) missing.push({ key: "prayer", label: "pray", route: "prayer" });
    if (!ctx.did_word) missing.push({ key: "word", label: "read the Word", route: "memoryVerses" });
    if (!ctx.did_reflection) missing.push({ key: "reflection", label: "reflect", route: "devotional" });
    if (missing.length > 0 && missing.length < 3 && ctx.any_today) {
      const m = missing[0]!;
      candidates.push({
        id: `rhythm_${m.key}`,
        title: "Finish today's rhythm",
        body: `You still have time to ${missing.map((x) => x.label).join(" and ")}.`,
        cta_label: "Continue rhythm",
        route: m.route,
        accent: "gold",
        priority: 55,
      });
    }

    // Strengthen the weakest discipline (the lowest score that isn't already maxed).
    const weak = weakest(scores);
    if (weak) {
      candidates.push({ ...weak, priority: 45 });
    }

    // Always-available affirmation so the hero is never empty.
    candidates.push({
      id: "affirm",
      title: "You're walking faithfully",
      body: `Your growth is ${scores.overall.band.toLowerCase()}. Keep going.`,
      cta_label: "See your pathway",
      route: "pathway",
      accent: "steady",
      priority: 10,
    });

    candidates.sort((a, b) => b.priority - a.priority);
    return { action: candidates[0] ?? null };
  }
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const then = new Date(date + "T00:00:00Z").getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function weakest(scores: { [k: string]: unknown }): NextAction | null {
  const map: Array<{ key: string; route: HomeRoute; title: string; body: string; cta: string; accent: NextAction["accent"] }> = [
    { key: "prayer", route: "prayer", title: "Grow in prayer", body: "Spend a moment with God in your prayer journal.", cta: "Open prayer journal", accent: "gold" },
    { key: "word", route: "memoryVerses", title: "Hide His Word", body: "Practise a memory verse — even one line counts.", cta: "Practise a verse", accent: "steady" },
    { key: "habits", route: "devotional", title: "Build your rhythm", body: "A small daily habit compounds. Start with today's devotional.", cta: "Open devotional", accent: "gold" },
    { key: "curriculum", route: "pathway", title: "Keep learning", body: "Move one step further on your pathway.", cta: "Continue pathway", accent: "navy" },
    { key: "attendance", route: "events", title: "Gather with the body", body: "Find your next gathering and join in.", cta: "See events", accent: "success" },
  ];
  let best: { key: string; score: number } | null = null;
  for (const m of map) {
    const s = (scores[m.key] as { score?: number } | undefined)?.score;
    if (typeof s !== "number" || s >= 100) continue;
    if (!best || s < best.score) best = { key: m.key, score: s };
  }
  if (!best) return null;
  const def = map.find((m) => m.key === best!.key)!;
  return { id: `weak_${def.key}`, title: def.title, body: def.body, cta_label: def.cta, route: def.route, accent: def.accent, priority: 45 };
}
