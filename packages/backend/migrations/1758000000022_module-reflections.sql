-- Migration 22 · Module reflections unification (Design Contract Matrix B3)
-- ============================================================================
-- The mobile design shows per-module reflections with review states (Pending /
-- Approved / Returned / Deferred) and the portal has a reflection queue with an
-- internal pastoral note. v1 had only LEVEL reflections (graduation gate) plus a
-- free-text module_progress.reflection_text that was never reviewable.
--
-- This migration: extends review_state with 'returned' (sent back to the member
-- to edit — re-locks gating until resubmitted) and 'deferred' (parked; does NOT
-- block gating); adds a reviewable module_reflections table (one current
-- reflection per progress row; history lives in audit_log); and backfills
-- legacy reflection_text rows as 'approved' so no member's gating regresses.
-- ============================================================================

-- Up Migration

ALTER TYPE review_state ADD VALUE IF NOT EXISTS 'returned';
ALTER TYPE review_state ADD VALUE IF NOT EXISTS 'deferred';

CREATE TABLE module_reflections (
  reflection_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_id    UUID NOT NULL REFERENCES module_progress(progress_id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  module_id      UUID NOT NULL REFERENCES modules(module_id),
  body           TEXT NOT NULL,
  state          review_state NOT NULL DEFAULT 'pending',
  reviewed_by    UUID REFERENCES users(user_id),
  feedback_notes TEXT,                            -- shown to the member ("Returned" reason)
  pastoral_note  TEXT,                            -- internal only, never sent to the member
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at    TIMESTAMPTZ,
  UNIQUE (progress_id)                            -- current reflection; resubmit updates in place
);

CREATE INDEX idx_module_reflections_queue ON module_reflections (state, submitted_at) WHERE state = 'pending';
CREATE INDEX idx_module_reflections_user ON module_reflections (user_id);

-- Backfill: pre-existing free-text reflections were auto-accepted, so they enter
-- the new model as approved (no gating regression).
INSERT INTO module_reflections (progress_id, user_id, module_id, body, state, submitted_at)
SELECT mp.progress_id, e.user_id, mp.module_id, mp.reflection_text, 'approved', COALESCE(mp.completed_at, now())
  FROM module_progress mp
  JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
 WHERE mp.reflection_text IS NOT NULL
ON CONFLICT (progress_id) DO NOTHING;

-- Down Migration

DROP INDEX IF EXISTS idx_module_reflections_user;
DROP INDEX IF EXISTS idx_module_reflections_queue;
DROP TABLE IF EXISTS module_reflections;
-- (enum values are intentionally left in place — PostgreSQL cannot drop them)
