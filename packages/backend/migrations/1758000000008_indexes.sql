-- Migration 08 · Indexing strategy (spec §2.3)
-- Chosen from the actual query shapes in §1.10 and §3, not speculatively.
-- (idx_engagement_cell_score is created in migration 05 alongside its table;
--  transactions.idempotency_key and processed_webhooks.event_id are already
--  indexed by their UNIQUE/PRIMARY KEY constraints, so they are not repeated.)
-- ============================================================================

-- Up Migration

-- Admin listing members by branch and role.
CREATE INDEX idx_users_congregation_role ON users (congregation_id, role);

-- Fuzzy member search in the portal.
CREATE INDEX idx_users_fullname_trgm ON users USING gin (full_name gin_trgm_ops);

-- Gating checks and Cᵢ counting.
CREATE INDEX idx_module_progress_enrollment_completed
  ON module_progress (enrollment_id, is_completed);

-- 30-day Hᵢ window aggregation (cascades to every partition of interaction_events).
CREATE INDEX idx_interaction_user_time
  ON interaction_events (user_id, occurred_at DESC);

-- 30-day Aᵢ window aggregation.
CREATE INDEX idx_attendance_user_time
  ON attendance_logs (user_id, checked_in_at DESC);

-- The pastor review queue (partial index).
CREATE INDEX idx_reviews_pending
  ON reflection_reviews (state, submitted_at) WHERE state = 'pending';

-- Delta-pull "everything for this user since cursor".
CREATE INDEX idx_change_log_user_domain
  ON change_log (user_id, domain, change_id);

-- Worker poll for due side-effects (partial index).
CREATE INDEX idx_outbox_due
  ON outbox (status, available_at) WHERE status = 'pending';

-- Down Migration

DROP INDEX IF EXISTS idx_outbox_due;
DROP INDEX IF EXISTS idx_change_log_user_domain;
DROP INDEX IF EXISTS idx_reviews_pending;
DROP INDEX IF EXISTS idx_attendance_user_time;
DROP INDEX IF EXISTS idx_interaction_user_time;
DROP INDEX IF EXISTS idx_module_progress_enrollment_completed;
DROP INDEX IF EXISTS idx_users_fullname_trgm;
DROP INDEX IF EXISTS idx_users_congregation_role;
