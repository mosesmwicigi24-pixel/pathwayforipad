// Mobile auth + money guard — pure logic, no React Native / network.
import { describe, it, expect } from "vitest";
import { InMemoryTokenVault } from "../src/auth/tokenVault";
import { withRefresh } from "../src/auth/session";
import { ManualConnectivity, assertOnlineForGiving, MONEY_DOMAINS } from "../src/net/connectivity";
import { SyncEngine, type SyncApi } from "../src/sync/syncEngine";
import { InMemoryLocalStore } from "../src/db/inMemoryLocalStore";

const unauthorized = (): Error => Object.assign(new Error("401"), { response: { status: 401 } });
const serverError = (): Error => Object.assign(new Error("500"), { response: { status: 500 } });
const noopApi: SyncApi = {
  pull: () => Promise.resolve({ changes: {}, tombstones: {}, cursors: {} }),
  push: () => Promise.resolve({ results: [] }),
};

describe("TokenVault (§5.7)", () => {
  it("stores, reads, and clears tokens", async () => {
    const v = new InMemoryTokenVault();
    expect(await v.getAccess()).toBeNull();
    await v.setTokens("a", "r");
    expect(await v.getAccess()).toBe("a");
    expect(await v.getRefresh()).toBe("r");
    await v.clear();
    expect(await v.getAccess()).toBeNull();
  });
});

describe("withRefresh — 401 → refresh → retry once (§5.3)", () => {
  it("refreshes, persists the rotated pair, and retries", async () => {
    const v = new InMemoryTokenVault();
    await v.setTokens("stale", "r1");
    let calls = 0;
    let refreshes = 0;

    const out = await withRefresh(
      (token) => {
        calls += 1;
        if (token === "stale") throw unauthorized();
        return Promise.resolve(`ok:${token}`);
      },
      v,
      (rt) => {
        refreshes += 1;
        expect(rt).toBe("r1");
        return Promise.resolve({ access: "fresh", refresh: "r2" });
      },
    );

    expect(out).toBe("ok:fresh");
    expect(calls).toBe(2);
    expect(refreshes).toBe(1);
    expect(await v.getAccess()).toBe("fresh");
    expect(await v.getRefresh()).toBe("r2");
  });

  it("rethrows non-401 errors without refreshing", async () => {
    const v = new InMemoryTokenVault();
    await v.setTokens("a", "r");
    await expect(
      withRefresh(() => Promise.reject(serverError()), v, () => Promise.reject(new Error("must not refresh"))),
    ).rejects.toThrow("500");
  });

  it("rethrows 401 when there is no refresh token", async () => {
    const v = new InMemoryTokenVault();
    await expect(
      withRefresh(() => Promise.reject(unauthorized()), v, () => Promise.resolve({ access: "x", refresh: "y" })),
    ).rejects.toThrow("401");
  });
});

describe("money guard — never queued offline (§5.6)", () => {
  it("blocks the giving flow when offline and allows it when online", async () => {
    await expect(assertOnlineForGiving(new ManualConnectivity(false))).rejects.toThrow(/never queued offline/i);
    await expect(assertOnlineForGiving(new ManualConnectivity(true))).resolves.toBeUndefined();
  });

  it("refuses to enqueue any money-domain mutation", async () => {
    const engine = new SyncEngine(noopApi, new InMemoryLocalStore());
    for (const domain of MONEY_DOMAINS) {
      await expect(engine.enqueue(domain, "intent", { amount_minor: 1000 })).rejects.toThrow(
        /never queued offline/i,
      );
    }
    // a non-money mutation still queues fine
    await expect(engine.enqueue("module_progress", "complete", { module_id: "m1" })).resolves.toBeTruthy();
  });
});
