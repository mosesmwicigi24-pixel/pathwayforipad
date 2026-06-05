// Thin query helpers over node-postgres. Modules code against these instead of
// touching the pool directly, so transactions, change-log writes, and outbox
// enqueues stay consistent (§1.6, §1.11). Parameterised queries only (§5.8).
import type { Pool, PoolClient } from "pg";
import { ApiError } from "../http/errors.js";

export type Queryable = Pool | PoolClient;

export async function many<T>(q: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await q.query(text, params as never[]);
  return res.rows as T[];
}

export async function maybeOne<T>(
  q: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await many<T>(q, text, params);
  return rows[0] ?? null;
}

/** Like maybeOne but throws 404 NOT_FOUND when absent. */
export async function one<T>(q: Queryable, text: string, params: unknown[] = []): Promise<T> {
  const row = await maybeOne<T>(q, text, params);
  if (row === null) throw new ApiError("NOT_FOUND", "Resource not found");
  return row;
}

/** Run fn inside a transaction; commit on success, rollback on throw. */
export async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- Sync change-log (§2.2 change_log, feeds delta-pull §3.6) ---
export async function recordChange(
  c: Queryable,
  domain: string,
  rowId: string | null,
  userId: string | null,
  op: "upsert" | "delete" = "upsert",
): Promise<void> {
  await c.query(
    `INSERT INTO change_log (domain, row_id, user_id, op) VALUES ($1,$2,$3,$4)`,
    [domain, rowId, userId, op],
  );
}

// --- Transactional outbox (§1.6) — enqueue a side-effect in the same tx ---
export async function enqueueOutbox(
  c: Queryable,
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await c.query(`INSERT INTO outbox (topic, payload) VALUES ($1,$2)`, [topic, JSON.stringify(payload)]);
}

// --- Append-only audit (§5.10) ---
export async function audit(
  c: Queryable,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
    [actorId, action, entity, entityId, JSON.stringify(metadata)],
  );
}
