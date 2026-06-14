import { describe, it, expect } from "vitest";
import type { PendingMutation } from "@nuru/shared";
import { AsyncStorageLocalStore } from "../src/db/asyncStorageLocalStore";
import { MemoryKeyValueStore } from "../src/db/keyValueStore";

const mut = (id: string, seq: number): PendingMutation => ({
  mutation_id: id, seq, domain: "prayer_entries", op: "upsert", payload: { entry_id: id }, status: "pending",
});

describe("AsyncStorageLocalStore", () => {
  it("queues mutations in seq order and clears applied ones", async () => {
    const s = new AsyncStorageLocalStore(new MemoryKeyValueStore());
    await s.enqueueMutation(mut("b", 2));
    await s.enqueueMutation(mut("a", 1));
    expect((await s.pendingMutations()).map((m) => m.mutation_id)).toEqual(["a", "b"]);
    await s.clearMutations(["a"]);
    expect((await s.pendingMutations()).map((m) => m.mutation_id)).toEqual(["b"]);
  });

  it("round-trips cursors and the row cache, and deletes tombstoned rows", async () => {
    const s = new AsyncStorageLocalStore(new MemoryKeyValueStore());
    expect(await s.getCursor("modules")).toBeUndefined();
    await s.setCursor("modules", 42);
    expect(await s.getCursor("modules")).toBe(42);

    await s.cacheUpsert("saved_verses", "v1", { saved_verse_id: "v1", reference: "John 3:16" });
    await s.cacheUpsert("saved_verses", "v2", { saved_verse_id: "v2", reference: "Psalm 23" });
    expect((await s.cacheList("saved_verses")).length).toBe(2);
    await s.cacheDelete("saved_verses", "v1");
    const left = await s.cacheList("saved_verses");
    expect(left.map((r) => r.saved_verse_id)).toEqual(["v2"]);
  });

  it("persists across a cold start (new store instance over the same storage)", async () => {
    const kv = new MemoryKeyValueStore();
    const a = new AsyncStorageLocalStore(kv);
    await a.enqueueMutation(mut("x", 1));
    await a.setCursor("modules", 7);
    await a.cacheUpsert("prayer_entries", "p1", { entry_id: "p1", body: "pray" });

    const b = new AsyncStorageLocalStore(kv); // simulate app restart
    expect((await b.pendingMutations()).map((m) => m.mutation_id)).toEqual(["x"]);
    expect(await b.getCursor("modules")).toBe(7);
    expect((await b.cacheList("prayer_entries")).length).toBe(1);
  });
});
