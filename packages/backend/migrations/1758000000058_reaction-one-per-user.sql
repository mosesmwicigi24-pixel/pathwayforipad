-- Migration 58 · One reaction per person (Facebook-style, mutually exclusive)
-- ============================================================================
-- A member may hold exactly ONE reaction emoji per subject. Picking a different
-- emoji moves the vote; re-picking the same one clears it. Counts stay cumulative
-- across everyone. Collapse any stacked rows (keep the latest), then make
-- (subject_type, subject_id, user_id) the primary key.
-- ============================================================================

-- Up Migration
DELETE FROM content_reactions c
 WHERE c.ctid NOT IN (
   SELECT DISTINCT ON (subject_type, subject_id, user_id) ctid
     FROM content_reactions
    ORDER BY subject_type, subject_id, user_id, created_at DESC
 );
ALTER TABLE content_reactions DROP CONSTRAINT content_reactions_pkey;
ALTER TABLE content_reactions ADD CONSTRAINT content_reactions_pkey
  PRIMARY KEY (subject_type, subject_id, user_id);

-- Down Migration
ALTER TABLE content_reactions DROP CONSTRAINT content_reactions_pkey;
ALTER TABLE content_reactions ADD CONSTRAINT content_reactions_pkey
  PRIMARY KEY (subject_type, subject_id, user_id, emoji);
