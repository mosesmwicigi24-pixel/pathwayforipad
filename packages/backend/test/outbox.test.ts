// Transactional outbox worker — dispatch, retry/backoff, dead-letter (§1.6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { enqueueOutbox } from "../src/db/db.js";
import { OutboxWorker, type OutboxHandler } from "../src/workers/outbox.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import { testEnv } from "./helpers/app.js";
import type { AppContext } from "../src/http/context.js";

const ctx = (): AppContext =>
  ({ env: testEnv(), db: { primary: testPool(), replica: testPool() } }) as AppContext;

describe("outbox worker (§1.6)", () => {
  let user: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("dispatches certificate.issue and marks the row done", async () => {
    await enqueueOutbox(testPool(), "certificate.issue", { user_id: user, level_number: 1 });
    const worker = new OutboxWorker(testPool(), buildOutboxHandlers(ctx()));
    const res = await worker.drainOnce();
    expect(res).toMatchObject({ processed: 1, done: 1 });

    const cert = await testPool().query("SELECT count(*)::int n FROM certificates WHERE user_id=$1", [user]);
    expect(cert.rows[0].n).toBe(1);
    const ob = await testPool().query("SELECT status FROM outbox");
    expect(ob.rows[0].status).toBe("done");
  });

  it("retries a failing handler, then dead-letters at maxAttempts", async () => {
    await enqueueOutbox(testPool(), "boom", { x: 1 });
    const handlers = new Map<string, OutboxHandler>([
      ["boom", () => Promise.reject(new Error("nope"))],
    ]);
    const worker = new OutboxWorker(testPool(), handlers, undefined, { maxAttempts: 2, backoffMs: 0 });

    const first = await worker.drainOnce();
    expect(first.retried).toBe(1);
    let ob = await testPool().query("SELECT status, attempts FROM outbox");
    expect(ob.rows[0]).toMatchObject({ status: "pending", attempts: 1 });

    const second = await worker.drainOnce();
    expect(second.dead).toBe(1);
    ob = await testPool().query("SELECT status, attempts FROM outbox");
    expect(ob.rows[0]).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("acknowledges an unknown topic (no handler) instead of spinning", async () => {
    await enqueueOutbox(testPool(), "unhandled.topic", {});
    const worker = new OutboxWorker(testPool(), new Map());
    const res = await worker.drainOnce();
    expect(res.done).toBe(1);
    const ob = await testPool().query("SELECT status FROM outbox");
    expect(ob.rows[0].status).toBe("done");
  });

  it("two concurrent drainers never double-process a row (SKIP LOCKED, §1.6)", async () => {
    for (let i = 0; i < 6; i++) await enqueueOutbox(testPool(), "count.me", { i });

    const seen: number[] = [];
    const handlers = new Map<string, OutboxHandler>([
      [
        "count.me",
        async (p) => {
          seen.push(p.i as number);
          await new Promise((r) => setTimeout(r, 15)); // hold the lock briefly
        },
      ],
    ]);
    const w1 = new OutboxWorker(testPool(), handlers, undefined, { batchSize: 6 });
    const w2 = new OutboxWorker(testPool(), handlers, undefined, { batchSize: 6 });

    const [a, b] = await Promise.all([w1.drainOnce(), w2.drainOnce()]);
    expect(a.done + b.done).toBe(6); // all rows processed
    expect(seen.length).toBe(6); // each handler run exactly once
    expect(new Set(seen).size).toBe(6); // no duplicates

    const done = await testPool().query("SELECT count(*)::int n FROM outbox WHERE status='done'");
    expect(done.rows[0].n).toBe(6);
  });
});
