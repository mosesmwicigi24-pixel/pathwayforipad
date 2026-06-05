-- Migration 09 · Initial monthly partitions for interaction_events (spec §2.4)
-- In production, pg_partman (or the cron function in db/partition-maintenance.sql)
-- keeps N+2 months provisioned and prunes > 13 months (§5.9). These initial
-- partitions bootstrap the table so writes work from day one.
-- ============================================================================

-- Up Migration

CREATE TABLE interaction_events_2026_06 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE interaction_events_2026_07 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE interaction_events_2026_08 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE interaction_events_2026_09 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE interaction_events_2026_10 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE interaction_events_2026_11 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE interaction_events_2026_12 PARTITION OF interaction_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Safety net so an event with an out-of-range timestamp is never rejected.
CREATE TABLE interaction_events_default PARTITION OF interaction_events DEFAULT;

-- Down Migration

DROP TABLE IF EXISTS interaction_events_default;
DROP TABLE IF EXISTS interaction_events_2026_12;
DROP TABLE IF EXISTS interaction_events_2026_11;
DROP TABLE IF EXISTS interaction_events_2026_10;
DROP TABLE IF EXISTS interaction_events_2026_09;
DROP TABLE IF EXISTS interaction_events_2026_08;
DROP TABLE IF EXISTS interaction_events_2026_07;
DROP TABLE IF EXISTS interaction_events_2026_06;
