// Member growth scores (§1.8 extended). A small, server-authoritative (§1.1)
// scoring layer over the activity already captured in the DB. Every score is
// 0–100, blends CONSISTENCY (recent cadence) with DEPTH (quality), is
// recency-weighted (a lapse decays, never zeros), and pastoral (formative, not a
// leaderboard). This module is the home for all member scores; Word ships first,
// Prayer / Habits / Curriculum / Attendance / composite follow the same shape.
import type { Pool } from "pg";
import { one } from "../../db/db.js";

const TZ = "Africa/Nairobi"; // EAT day boundary, matches the rhythm engine

export interface ScoreBreakdown {
  score: number; // 0–100 composite
  band: string; // pastoral label
  components: Record<string, number>; // each 0–100
  detail: Record<string, number>; // raw counts for transparency
}

function band(score: number): string {
  if (score >= 80) return "Deeply rooted";
  if (score >= 60) return "Growing";
  if (score >= 35) return "Sprouting";
  return "Just beginning";
}

export class ScoresService {
  constructor(private readonly pool: Pool) {}

  /**
   * WORD score — "how is the Word taking root in you?"
   *   • consistency (0.45): distinct days in the last 14 you engaged Scripture
   *     (a 'word' rhythm tick or a 'scripture_read' event); 10 of 14 days = full.
   *   • memorization (0.40): half from your mastery RATE (mastered / attempted),
   *     half from your average best match % — depth of hiding the Word in the heart.
   *   • breadth (0.15): how many distinct verses you've engaged; 10 = full.
   * Recency lives in the 14-day window; memorization is forgiving (monotonic best %).
   */
  async word(userId: string): Promise<ScoreBreakdown> {
    const row = await one<{
      attempted: number;
      mastered: number;
      avg_match: number;
      active_days_14: number;
    }>(
      this.pool,
      `WITH verse AS (
         SELECT count(*)::int AS attempted,
                count(*) FILTER (WHERE status = 'mastered')::int AS mastered,
                COALESCE(round(avg(best_match_pct)), 0)::int AS avg_match
           FROM memory_verse_progress
          WHERE user_id = $1
       ),
       days AS (
         SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS active_days_14
           FROM interaction_events
          WHERE user_id = $1
            AND kind IN ('word', 'scripture_read')
            AND occurred_at >= now() - interval '14 days'
       )
       SELECT v.attempted, v.mastered, v.avg_match, d.active_days_14
         FROM verse v, days d`,
      [userId, TZ],
    );

    const consistency = Math.min(100, Math.round((100 * row.active_days_14) / 10));
    const memorization =
      row.attempted === 0
        ? 0
        : Math.round(0.5 * ((100 * row.mastered) / row.attempted) + 0.5 * row.avg_match);
    const breadth = Math.min(100, Math.round((100 * row.attempted) / 10));
    const score = Math.round(0.45 * consistency + 0.4 * memorization + 0.15 * breadth);

    return {
      score,
      band: band(score),
      components: { consistency, memorization, breadth },
      detail: {
        verses_engaged: row.attempted,
        verses_mastered: row.mastered,
        avg_match_pct: row.avg_match,
        active_days_14: row.active_days_14,
      },
    };
  }
}
