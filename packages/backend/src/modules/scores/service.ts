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

  /**
   * PRAYER score — "how is your prayer life?"
   *   • consistency (0.60): distinct days you prayed (a 'prayer' rhythm tick, now
   *     emitted when you journal a prayer) in the last 14; 10 days = full.
   *   • depth (0.40): breadth of your prayer life (entries, 10 = full) + the share
   *     marked answered (testimony of God moving). Private — never leaves the member.
   */
  async prayer(userId: string): Promise<ScoreBreakdown> {
    const row = await one<{ total: number; answered: number; prayer_days_14: number }>(
      this.pool,
      `WITH entries AS (
         SELECT count(*)::int AS total, count(*) FILTER (WHERE is_answered)::int AS answered
           FROM prayer_entries WHERE user_id = $1
       ),
       days AS (
         SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS prayer_days_14
           FROM interaction_events
          WHERE user_id = $1 AND kind = 'prayer' AND occurred_at >= now() - interval '14 days'
       )
       SELECT e.total, e.answered, d.prayer_days_14 FROM entries e, days d`,
      [userId, TZ],
    );
    const consistency = Math.min(100, Math.round((100 * row.prayer_days_14) / 10));
    const depth =
      row.total === 0
        ? 0
        : Math.round(0.6 * Math.min(100, (100 * row.total) / 10) + 0.4 * ((100 * row.answered) / row.total));
    const score = Math.round(0.6 * consistency + 0.4 * depth);
    return {
      score,
      band: band(score),
      components: { consistency, depth },
      detail: { prayers_logged: row.total, answered: row.answered, prayer_days_14: row.prayer_days_14 },
    };
  }

  /**
   * HABITS score — "how steady is your daily rhythm?" (prayer/word/reflection)
   *   • consistency (0.60): distinct days with ≥1 discipline in the last 14.
   *   • completeness (0.40): share of all 42 possible discipline-ticks (3×14) hit.
   * Also surfaces this week's rhythm % (ticks / 21) for the weekly gauge.
   */
  async habits(userId: string): Promise<ScoreBreakdown> {
    const row = await one<{ active_days_14: number; ticks_14: number; ticks_7: number }>(
      this.pool,
      `SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS active_days_14,
              count(*)::int AS ticks_14,
              count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS ticks_7
         FROM interaction_events
        WHERE user_id = $1 AND kind IN ('prayer', 'word', 'reflection')
          AND occurred_at >= now() - interval '14 days'`,
      [userId, TZ],
    );
    const consistency = Math.min(100, Math.round((100 * row.active_days_14) / 10));
    const completeness = Math.min(100, Math.round((100 * row.ticks_14) / (3 * 14)));
    const score = Math.round(0.6 * consistency + 0.4 * completeness);
    return {
      score,
      band: band(score),
      components: { consistency, completeness },
      detail: {
        active_days_14: row.active_days_14,
        rhythm_week_pct: Math.min(100, Math.round((100 * row.ticks_7) / 21)),
      },
    };
  }

  /**
   * CURRICULUM score — "how is your learning going?"
   *   • completion (0.65): published modules you've completed (mirrors leader Cᵢ).
   *   • mastery (0.35): your average score on passed quizzes — depth of understanding
   *     (the score we capture but never used). Pure completion when you've no quizzes.
   */
  async curriculum(userId: string): Promise<ScoreBreakdown> {
    const row = await one<{ completed: number; published: number; avg_score: number; attempts: number }>(
      this.pool,
      `WITH cur AS (
         SELECT count(*) FILTER (WHERE mp.is_completed)::int AS completed
           FROM enrollments e JOIN module_progress mp USING (enrollment_id)
          WHERE e.user_id = $1
       ),
       pub AS (SELECT GREATEST(count(*), 1)::int AS total FROM modules WHERE is_published),
       qz AS (
         SELECT COALESCE(round(avg(qa.score_achieved)), 0)::int AS avg_score, count(*)::int AS attempts
           FROM quiz_attempts qa
           JOIN module_progress mp ON mp.progress_id = qa.progress_id
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
          WHERE e.user_id = $1 AND qa.is_passed
       )
       SELECT cur.completed, pub.total AS published, qz.avg_score, qz.attempts FROM cur, pub, qz`,
      [userId],
    );
    const completion = Math.min(100, Math.round((100 * row.completed) / row.published));
    const mastery = row.attempts === 0 ? null : row.avg_score;
    const score = mastery === null ? completion : Math.round(0.65 * completion + 0.35 * mastery);
    return {
      score,
      band: band(score),
      components: mastery === null ? { completion } : { completion, mastery },
      detail: { modules_completed: row.completed, modules_published: row.published, quizzes_passed: row.attempts },
    };
  }

  /**
   * ATTENDANCE score — "are you gathering with the body?" Mirrors the leader Aᵢ:
   * check-ins in the last 30 days against the cell's meeting cadence, so the
   * member view never disagrees with the pastoral metric.
   */
  async attendance(userId: string): Promise<ScoreBreakdown> {
    const row = await one<{ attended_30: number; cadence: number }>(
      this.pool,
      `SELECT COALESCE(count(al.attendance_id) FILTER (WHERE al.checked_in_at >= now() - interval '30 days'), 0)::int AS attended_30,
              GREATEST(COALESCE(cg.meeting_cadence, 1), 1)::int AS cadence
         FROM users u
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
         LEFT JOIN attendance_logs al ON al.user_id = u.user_id
        WHERE u.user_id = $1
        GROUP BY cg.meeting_cadence`,
      [userId],
    );
    const score = Math.min(100, Math.round((100 * row.attended_30) / row.cadence));
    return {
      score,
      band: band(score),
      components: { attendance: score },
      detail: { attended_30d: row.attended_30, expected: row.cadence },
    };
  }

  /** Composite — all five scores + a weighted overall (mirrors engagement weights,
   *  plus Word/Prayer as the spiritual-formation axes). One round-trip for Home. */
  async all(userId: string): Promise<{ overall: { score: number; band: string }; [k: string]: unknown }> {
    const [habits, curriculum, attendance, word, prayer] = await Promise.all([
      this.habits(userId),
      this.curriculum(userId),
      this.attendance(userId),
      this.word(userId),
      this.prayer(userId),
    ]);
    const overallScore = Math.round(
      0.25 * habits.score + 0.25 * curriculum.score + 0.2 * attendance.score + 0.15 * word.score + 0.15 * prayer.score,
    );
    return {
      overall: { score: overallScore, band: band(overallScore) },
      habits,
      curriculum,
      attendance,
      word,
      prayer,
    };
  }
}
