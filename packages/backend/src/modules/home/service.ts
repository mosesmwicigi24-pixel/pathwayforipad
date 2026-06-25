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
import type { AiProvider } from "../assistant/provider.js";
import { pickVerse, THEME_REASON, type VerseTheme } from "./verses.js";

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

export interface TailoredVerse {
  reference: string;
  version: string;
  theme: VerseTheme;
  reason: string; // a warm "why this verse is for you" line
}

export class HomeService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider | null = null,
    private readonly scores = new ScoresService(pool),
  ) {}

  /**
   * A warm, one-line greeting personal to the member, written by Nuru and cached
   * once per EAT day (the model is called at most once/day/user). Pure copy inside
   * the existing card — it never changes layout. Falls back to a gentle template
   * when there's no live model (dev/tests) or a generation fails.
   */
  async dailyGreeting(userId: string): Promise<{ greeting: string }> {
    const cached = await maybeOne<{ text: string }>(
      this.pool,
      `SELECT text FROM home_greetings WHERE user_id = $1 AND day_date = (now() AT TIME ZONE $2)::date`,
      [userId, TZ],
    );
    if (cached) return { greeting: cached.text };

    const u = await maybeOne<{ full_name: string }>(this.pool, `SELECT full_name FROM users WHERE user_id = $1`, [userId]);
    const firstName = (u?.full_name ?? "friend").trim().split(/\s+/)[0] || "friend";
    const day = await one<{ d: string }>(this.pool, `SELECT (now() AT TIME ZONE $1)::date::text AS d`, [TZ]);
    const fallback = fallbackGreeting(firstName, userId, day.d);

    // No live model (dev / tests): a warm line that rotates by member & day so it
    // still feels personal and fresh, cached for the day.
    if (!this.provider || this.provider.name === "fake") {
      await this.cacheGreeting(userId, fallback);
      return { greeting: fallback };
    }

    try {
      const scores = await this.scores.all(userId);
      const weak = lowestLabel(scores);
      const streak = await maybeOne<{ n: number }>(
        this.pool,
        `SELECT current_streak_days AS n FROM user_streaks WHERE user_id = $1`,
        [userId],
      );
      const system =
        "You are Nuru, a warm discipleship companion in a church app. Write ONE short, " +
        "encouraging greeting (max 20 words) for this member today. Be specific and hopeful; " +
        "you may reference Scripture lightly. No preamble, no quotes, no lists, plain sentence.";
      const streakLine = streak && streak.n >= 2 ? ` They are on a ${streak.n}-day rhythm streak.` : "";
      const ctx = `Member's first name: ${firstName}. Overall growth: ${scores.overall.band}. Area to gently nurture: ${weak}.${streakLine}`;
      const raw = (await this.provider.complete({ system, messages: [{ role: "user", text: ctx }] })).trim();
      const text = raw.replace(/^["']|["']$/g, "").slice(0, 240);
      if (text) {
        await this.cacheGreeting(userId, text);
        return { greeting: text };
      }
    } catch {
      /* generation failed — return the fallback uncached so the next open retries */
    }
    return { greeting: fallback };
  }

  private async cacheGreeting(userId: string, text: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO home_greetings (user_id, day_date, text)
       VALUES ($1, (now() AT TIME ZONE $2)::date, $3)
       ON CONFLICT (user_id, day_date) DO NOTHING`,
      [userId, TZ, text],
    );
  }

  /**
   * The member's "Verse for today" — a vetted Scripture *reference* chosen from a
   * curated, theme-tagged pool to match the discipline they're leaning into (or
   * the season they're in: brand-new, returning, thriving). Deterministic per EAT
   * day, cached so it's stable through the day, and it avoids verses the member
   * has seen in the last few weeks. The client fetches the actual text from
   * /scripture, so doctrine stays safe — we only personalise *which* verse. (§1.1)
   */
  async verseForToday(userId: string): Promise<TailoredVerse> {
    const cached = await maybeOne<{ reference: string; version: string; theme: string; reason: string }>(
      this.pool,
      `SELECT reference, version, theme, reason FROM home_verses
        WHERE user_id = $1 AND day_date = (now() AT TIME ZONE $2)::date`,
      [userId, TZ],
    );
    if (cached) return { reference: cached.reference, version: cached.version, theme: cached.theme as VerseTheme, reason: cached.reason };

    const day = await one<{ d: string }>(this.pool, `SELECT (now() AT TIME ZONE $1)::date::text AS d`, [TZ]);
    const theme = await this.verseTheme(userId);
    const recent = (
      await this.pool.query<{ reference: string }>(
        `SELECT reference FROM home_verses WHERE user_id = $1 ORDER BY day_date DESC LIMIT 20`,
        [userId],
      )
    ).rows.map((r) => r.reference);

    const reference = pickVerse(theme, userId, day.d, recent);
    const reason = THEME_REASON[theme];
    await this.pool.query(
      `INSERT INTO home_verses (user_id, day_date, reference, theme, reason, version)
       VALUES ($1, (now() AT TIME ZONE $2)::date, $3, $4, $5, 'WEB')
       ON CONFLICT (user_id, day_date) DO NOTHING`,
      [userId, TZ, reference, theme, reason],
    );
    return { reference, version: "WEB", theme, reason };
  }

  /**
   * Decide the pastoral THEME for this member right now from their real signals:
   * a brand-new member gets a foundation; a returning member gets grace; otherwise
   * we lean into the discipline they most need to grow (their weakest score), and
   * a member who is thriving everywhere gets an uplifting word.
   */
  async verseTheme(userId: string): Promise<VerseTheme> {
    const scores = await this.scores.all(userId);
    const sig = await one<{ last_active_date: string | null; ever_active: boolean }>(
      this.pool,
      `SELECT (SELECT last_active_date FROM user_streaks WHERE user_id = $1) AS last_active_date,
              EXISTS (SELECT 1 FROM interaction_events WHERE user_id = $1) AS ever_active`,
      [userId],
    );
    const modulesCompleted = Number((scores.curriculum as ScoreBreakdown).detail.modules_completed ?? 0);

    // Brand-new: nothing done yet — ground them in identity and new life.
    if (modulesCompleted === 0 && !sig.ever_active) return "foundations";

    // Returning after a real lapse — welcome them back with grace.
    const lapsed = daysSince(sig.last_active_date);
    if (lapsed != null && lapsed >= 7) return "return";

    // Otherwise lean into the discipline they most need to grow.
    const weak = weakestKey(scores);
    if (weak) {
      const map: Record<string, VerseTheme> = {
        prayer: "prayer",
        word: "word",
        habits: "habits",
        curriculum: "growth",
        attendance: "fellowship",
      };
      const theme = map[weak.key];
      if (theme && weak.score < 80) return theme;
    }

    // Thriving across the board — a word of blessing over their life.
    return "uplift";
  }

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

function lowestLabel(scores: { [k: string]: unknown }): string {
  const labels: Record<string, string> = {
    prayer: "prayer",
    word: "time in the Word",
    habits: "daily rhythm",
    curriculum: "the pathway",
    attendance: "gathering with the cell",
  };
  let best: { key: string; score: number } | null = null;
  for (const key of Object.keys(labels)) {
    const s = (scores[key] as { score?: number } | undefined)?.score;
    if (typeof s !== "number") continue;
    if (!best || s < best.score) best = { key, score: s };
  }
  return best ? labels[best.key]! : "daily rhythm";
}

// Warm fallback greetings (no live model). Rotated per (member, day) so the line
// feels personal and changes daily instead of one static sentence for everyone.
const FALLBACK_GREETINGS = [
  (n: string) => `Grace and peace, ${n} — God is with you in today's step.`,
  (n: string) => `Good to see you, ${n}. His mercies are new this morning.`,
  (n: string) => `${n}, may you walk closely with Him today.`,
  (n: string) => `Welcome back, ${n} — take one faithful step today.`,
  (n: string) => `${n}, the Lord goes before you today. Be encouraged.`,
  (n: string) => `Peace to you, ${n}. God is doing a good work in you.`,
  (n: string) => `${n}, draw near to Him today and He will draw near to you.`,
];

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fallbackGreeting(firstName: string, userId: string, dayKey: string): string {
  const i = hashStr(`${userId}|${dayKey}`) % FALLBACK_GREETINGS.length;
  return FALLBACK_GREETINGS[i]!(firstName);
}

/** The member's lowest of the five disciplines (key + score), or null. */
function weakestKey(scores: { [k: string]: unknown }): { key: string; score: number } | null {
  let best: { key: string; score: number } | null = null;
  for (const key of ["prayer", "word", "habits", "curriculum", "attendance"]) {
    const s = (scores[key] as { score?: number } | undefined)?.score;
    if (typeof s !== "number") continue;
    if (!best || s < best.score) best = { key, score: s };
  }
  return best;
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
