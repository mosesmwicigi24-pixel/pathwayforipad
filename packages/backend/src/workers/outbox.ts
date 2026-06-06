// Transactional outbox worker (spec §1.6, §1.11). Business writes enqueue rows
// in the same tx as their state change; this worker drains them asynchronously,
// at-least-once, with retry/backoff and dead-lettering. Handlers are idempotent
// (they dedupe on their own keys), so a redelivery is safe. Claims use
// FOR UPDATE SKIP LOCKED so multiple workers/pods never process the same row.
import type { Pool } from "pg";
import type { Logger } from "pino";

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface OutboxWorkerOptions {
  batchSize?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

export interface DrainResult {
  processed: number;
  done: number;
  retried: number;
  dead: number;
}

export class OutboxWorker {
  constructor(
    private readonly pool: Pool,
    private readonly handlers: Map<string, OutboxHandler>,
    private readonly log?: Logger,
    private readonly opts: OutboxWorkerOptions = {},
  ) {}

  /** Claim and process one batch of due outbox rows. Returns per-outcome counts. */
  async drainOnce(): Promise<DrainResult> {
    const batchSize = this.opts.batchSize ?? 20;
    const maxAttempts = this.opts.maxAttempts ?? 5;
    const backoffMs = this.opts.backoffMs ?? 30_000;

    const { rows } = await this.pool.query<{
      outbox_id: string;
      topic: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `UPDATE outbox SET status = 'processing'
         WHERE outbox_id IN (
           SELECT outbox_id FROM outbox
            WHERE status = 'pending' AND available_at <= now()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
       RETURNING outbox_id, topic, payload, attempts`,
      [batchSize],
    );

    let done = 0;
    let retried = 0;
    let dead = 0;
    for (const row of rows) {
      const handler = this.handlers.get(row.topic);
      try {
        if (handler) await handler(row.payload);
        // Unknown topic ⇒ acknowledge so it never spins forever (logged once).
        else this.log?.warn({ topic: row.topic, outbox_id: row.outbox_id }, "outbox: no handler, acking");
        await this.pool.query(`UPDATE outbox SET status = 'done' WHERE outbox_id = $1`, [row.outbox_id]);
        done += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const isDead = attempts >= maxAttempts;
        await this.pool.query(
          `UPDATE outbox SET status = $2, attempts = $3,
                  available_at = now() + ($4 || ' milliseconds')::interval
             WHERE outbox_id = $1`,
          [row.outbox_id, isDead ? "dead" : "pending", attempts, String(backoffMs * attempts)],
        );
        if (isDead) dead += 1;
        else retried += 1;
        this.log?.error({ err, topic: row.topic, outbox_id: row.outbox_id, attempts }, "outbox handler failed");
      }
    }
    return { processed: rows.length, done, retried, dead };
  }

  /** Run drainOnce on an interval; returns a stop() function. */
  start(intervalMs = 5_000): () => void {
    const timer = setInterval(() => {
      void this.drainOnce().catch((err) => this.log?.error({ err }, "outbox drain crashed"));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
  }
}
