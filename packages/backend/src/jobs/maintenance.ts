// Scheduled maintenance jobs (spec §2.4, §5.9). Each is idempotent and safe to
// run concurrently across replicas (the SQL functions use IF NOT EXISTS / DROP IF
// EXISTS; the is_minor refresh is a plain idempotent UPDATE).
import type { Pool } from "pg";

/** Provision next N+2 months of interaction_events partitions and prune > retain months (§2.4, §5.9). */
export class PartitionMaintenance {
  constructor(private readonly pool: Pool) {}

  async run(monthsAhead = 2, retainMonths = 13): Promise<void> {
    await this.pool.query("SELECT fn_provision_interaction_partitions($1)", [monthsAhead]);
    await this.pool.query("SELECT fn_prune_interaction_partitions($1)", [retainMonths]);
  }

  provision(monthsAhead = 2): Promise<unknown> {
    return this.pool.query("SELECT fn_provision_interaction_partitions($1)", [monthsAhead]);
  }
  prune(retainMonths = 13): Promise<unknown> {
    return this.pool.query("SELECT fn_prune_interaction_partitions($1)", [retainMonths]);
  }
}

/**
 * Nightly recompute of users.is_minor so the trigger-maintained flag can't go
 * stale on an 18th birthday (the flagged §5.9 item). Only rows whose flag is wrong
 * are touched, so it doesn't churn updated_at across the table.
 */
export async function refreshMinorFlags(pool: Pool): Promise<{ updated: number }> {
  const res = await pool.query(
    `UPDATE users
        SET is_minor = COALESCE(date_of_birth > (CURRENT_DATE - INTERVAL '18 years'), FALSE),
            updated_at = now()
      WHERE deleted_at IS NULL
        AND is_minor IS DISTINCT FROM COALESCE(date_of_birth > (CURRENT_DATE - INTERVAL '18 years'), FALSE)`,
  );
  return { updated: res.rowCount ?? 0 };
}
