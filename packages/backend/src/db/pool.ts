// PostgreSQL connection pools (spec §1.6, §4.4). Two logical pools: the primary
// (writes) and a read-replica (dashboards/curriculum/telemetry). In every
// environment these DSNs point THROUGH PgBouncer in transaction-pooling mode, so
// thousands of stateless pods multiplex onto a small fixed server-side pool
// (§4.4, Appendix A.4) — the deadlock/exhaustion guard the scalability goal needs.
import { Pool } from "pg";
import type { Env } from "../config/env.js";

export interface DbPools {
  primary: Pool;
  replica: Pool;
}

export function createPools(env: Env): DbPools {
  const primary = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const replica = env.DATABASE_REPLICA_URL
    ? new Pool({ connectionString: env.DATABASE_REPLICA_URL, max: 10 })
    : primary; // fall back to primary when no replica is configured (local dev)
  return { primary, replica };
}

export async function closePools(pools: DbPools): Promise<void> {
  await pools.primary.end();
  if (pools.replica !== pools.primary) await pools.replica.end();
}
