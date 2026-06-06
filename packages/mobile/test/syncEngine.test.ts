// Mobile sync engine + local store — pure logic, no React Native runtime.
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryLocalStore } from "../src/db/inMemoryLocalStore";
import { SyncEngine, type SyncApi } from "../src/sync/syncEngine";
import type { PendingMutation, SyncPullResponse, SyncPushResponse } from "@nuru/shared";

class FakeApi implements SyncApi {
  public lastPush: { mutations: PendingMutation[] } | null = null;
  public lastPullCursors: Record<string, number> | null = null;

  push(body: { device_id?: string; mutations: PendingMutation[] }): Promise<SyncPushResponse> {
    this.lastPush = body;
    return Promise.resolve({
      results: body.mutations.map((m) => ({ mutation_id: m.mutation_id, status: "applied" as const })),
    });
  }

  pull(body: { device_id?: string; cursors: Record<string, number> }): Promise<SyncPullResponse> {
    this.lastPullCursors = body.cursors;
    return Promise.resolve({
      changes: { module_progress: [{ op: "upsert", row: { progress_id: "p1", is_completed: true } }] },
      tombstones: { modules: ["m-old"] },
      cursors: { module_progress: 5 },
    });
  }
}

describe("SyncEngine + InMemoryLocalStore", () => {
  let store: InMemoryLocalStore;
  let api: FakeApi;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new InMemoryLocalStore();
    api = new FakeApi();
    engine = new SyncEngine(api, store, "device-1");
  });

  it("assigns a monotonic per-device seq when enqueuing", async () => {
    const a = await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const b = await engine.enqueue("quiz_attempts", "submit", { module_id: "m1", answers: [] });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect((await store.pendingMutations()).length).toBe(2);
  });

  it("push replays the queue and clears applied mutations", async () => {
    await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const res = await engine.push();
    expect(res?.results[0]?.status).toBe("applied");
    expect(api.lastPush?.mutations.length).toBe(1);
    expect(await store.pendingMutations()).toHaveLength(0); // queue drained
  });

  it("push is a no-op (null) with an empty queue", async () => {
    expect(await engine.push()).toBeNull();
  });

  it("drops a rejected mutation from the queue but surfaces its reason (§3.6)", async () => {
    const rejecting: SyncApi = {
      pull: () => Promise.resolve({ changes: {}, tombstones: {}, cursors: {} }),
      push: (body) =>
        Promise.resolve({
          results: body.mutations.map((m) => ({
            mutation_id: m.mutation_id,
            status: "rejected" as const,
            code: "GATE_LOCKED",
            detail: "module 4 not yet unlocked",
          })),
        }),
    };
    const e = new SyncEngine(rejecting, store, "device-1");
    await e.enqueue("module_progress", "complete", { module_id: "m4" });
    const res = await e.push();
    expect(res?.results[0]).toMatchObject({ status: "rejected", code: "GATE_LOCKED" });
    expect(await store.pendingMutations()).toHaveLength(0); // removed, not retried forever
  });

  it("pull caches upserts, applies tombstones, and advances cursors", async () => {
    await store.cacheUpsert("modules", "m-old", { module_id: "m-old", title: "Stale" });

    await engine.pull();

    expect(await store.cacheList("module_progress")).toEqual([{ progress_id: "p1", is_completed: true }]);
    expect(await store.cacheList("modules")).toEqual([]); // tombstoned
    expect(await store.getCursor("module_progress")).toBe(5);
  });

  it("pull sends the stored cursors back to the server", async () => {
    await store.setCursor("module_progress", 3);
    await engine.pull();
    expect(api.lastPullCursors?.module_progress).toBe(3);
  });

  it("a full sync pushes then pulls", async () => {
    await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const { push, pull } = await engine.sync();
    expect(push?.results).toHaveLength(1);
    expect(pull.cursors.module_progress).toBe(5);
  });
});
