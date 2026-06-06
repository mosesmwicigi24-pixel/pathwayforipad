// App-wide LocalStore accessor — single shared instance, swappable (like the vault).
import { describe, it, expect } from "vitest";
import { getLocalStore, setLocalStore } from "../src/db/localStoreProvider";
import { InMemoryLocalStore } from "../src/db/inMemoryLocalStore";

describe("localStore provider", () => {
  it("returns one shared instance across calls", () => {
    expect(getLocalStore()).toBe(getLocalStore());
  });

  it("can be swapped (device SQLCipher store in production)", async () => {
    const swapped = new InMemoryLocalStore();
    setLocalStore(swapped);
    expect(getLocalStore()).toBe(swapped);
    // shared instance is read/writable
    await getLocalStore().cacheUpsert("modules", "m1", { module_id: "m1", title: "Test" });
    const rows = await getLocalStore().cacheList("modules");
    expect(rows.map((r) => r.module_id)).toContain("m1");
  });
});
