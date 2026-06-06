-- Engagement (Eᵢ) authoritative nightly recompute — verbatim from spec §2.5.
-- The batch worker runs this per cohort during local low-traffic hours and
-- upserts each row into engagement_scores, deriving `band` by CASE on e_score
-- (thresholds in §1.8 / @nuru/shared engagementBand()). This is the number the
-- multiplier cohort table sorts on (§1.3, §1.8).

WITH win AS (SELECT (CURRENT_DATE - INTERVAL '30 days') AS lo, CURRENT_DATE AS hi),
hab AS ( -- Hᵢ: active days / 20, capped
  SELECT user_id,
         LEAST(1.0, COUNT(DISTINCT date_trunc('day', occurred_at)) / 20.0) AS h
  FROM interaction_events, win
  WHERE occurred_at >= win.lo GROUP BY user_id),
cur AS ( -- Cᵢ: completed modules / live published-module count (fallback 45)
  SELECT e.user_id,
         LEAST(1.0, COUNT(*) FILTER (WHERE mp.is_completed)::numeric
               / COALESCE(NULLIF((SELECT count(*) FROM modules WHERE status = 'published'), 0), 45)) AS c
  FROM enrollments e JOIN module_progress mp USING (enrollment_id) GROUP BY e.user_id),
att AS ( -- Aᵢ: checkins / cell cadence, capped
  SELECT u.user_id,
         LEAST(1.0, COUNT(al.*)::numeric / GREATEST(cg.meeting_cadence, 1)) AS a
  FROM users u
  LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
  LEFT JOIN attendance_logs al ON al.user_id = u.user_id
    AND al.checked_in_at >= (CURRENT_DATE - INTERVAL '30 days')
  GROUP BY u.user_id, cg.meeting_cadence)
SELECT u.user_id, u.cell_group_id,
       COALESCE(hab.h, 0) h_score, COALESCE(cur.c, 0) c_score, COALESCE(att.a, 0) a_score,
       ROUND(0.40 * COALESCE(hab.h, 0) + 0.35 * COALESCE(cur.c, 0) + 0.25 * COALESCE(att.a, 0), 3) AS e_score
FROM users u
LEFT JOIN hab ON hab.user_id = u.user_id
LEFT JOIN cur ON cur.user_id = u.user_id
LEFT JOIN att ON att.user_id = u.user_id
WHERE u.deleted_at IS NULL AND u.role = 'Student';
