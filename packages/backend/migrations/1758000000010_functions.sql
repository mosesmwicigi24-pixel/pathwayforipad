-- Migration 10 · Server-side functions (spec §2.5)
-- The engagement aggregation query (§2.5) is NOT a migration object — it is the
-- query the nightly batch worker runs and upserts into engagement_scores. It is
-- kept verbatim as a versioned asset at db/engagement-aggregation.sql so the
-- worker and any review reference the same text.
-- ============================================================================

-- Up Migration

-- Gating check (server-side, callable from the Progress module). Verbatim §2.5.
CREATE OR REPLACE FUNCTION fn_module_unlocked(p_enrollment UUID, p_module UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT level_number, module_sequence_number FROM modules WHERE module_id = p_module),
  prev AS (SELECT module_id FROM modules, m
           WHERE modules.level_number = m.level_number
             AND modules.module_sequence_number = m.module_sequence_number - 1)
  SELECT CASE
    WHEN (SELECT module_sequence_number FROM m) = 1 THEN TRUE  -- first module of a level
    ELSE EXISTS (SELECT 1 FROM module_progress mp JOIN prev USING (module_id)
                 WHERE mp.enrollment_id = p_enrollment AND mp.is_completed)
  END;
$$;

-- Down Migration

DROP FUNCTION IF EXISTS fn_module_unlocked(UUID, UUID);
