-- Partition maintenance (spec §2.4, §4.4) — provisions next-month partitions for
-- interaction_events and prunes partitions older than 13 months (§5.9). Run from
-- a scheduled job (pg_partman is the production-recommended alternative). This
-- plain-SQL function keeps the dependency surface minimal.

CREATE OR REPLACE FUNCTION fn_provision_interaction_partitions(months_ahead INT DEFAULT 2)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  i INT;
  lo DATE;
  hi DATE;
  part TEXT;
BEGIN
  FOR i IN 0..months_ahead LOOP
    lo := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
    hi := lo + INTERVAL '1 month';
    part := format('interaction_events_%s', to_char(lo, 'YYYY_MM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF interaction_events FOR VALUES FROM (%L) TO (%L)',
        part, lo, hi);
    END IF;
  END LOOP;
END;
$$;

-- Prune raw interaction events older than 13 months (§5.9). The derived
-- engagement snapshot persists; only raw events are dropped.
CREATE OR REPLACE FUNCTION fn_prune_interaction_partitions(retain_months INT DEFAULT 13)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  cutoff DATE := date_trunc('month', CURRENT_DATE) - (retain_months || ' months')::interval;
BEGIN
  FOR r IN
    SELECT relname FROM pg_class
    WHERE relname ~ '^interaction_events_[0-9]{4}_[0-9]{2}$'
  LOOP
    IF to_date(right(r.relname, 7), 'YYYY_MM') < cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
    END IF;
  END LOOP;
END;
$$;
