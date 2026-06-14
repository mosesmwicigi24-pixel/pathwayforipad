import { describe, it, expect, vi } from "vitest";
import { startSyncLifecycle, type AppStateLike } from "../src/sync/syncLifecycle";
import { ManualConnectivity } from "../src/net/connectivity";
import type { SyncEngine } from "../src/sync/syncEngine";

function fakeAppState() {
  let handler: ((s: string) => void) | null = null;
  const removed = { value: false };
  const appState: AppStateLike = {
    addEventListener: (_t, h) => { handler = h; return { remove: () => { removed.value = true; handler = null; } }; },
  };
  return { appState, fire: (s: string) => handler?.(s), removed };
}

describe("startSyncLifecycle", () => {
  it("syncs on startup and again when the app returns to the foreground", async () => {
    const syncIfOnline = vi.fn().mockResolvedValue(null);
    const engine = { syncIfOnline } as unknown as SyncEngine;
    const { appState, fire } = fakeAppState();

    const stop = startSyncLifecycle({ engine, connectivity: new ManualConnectivity(true), appState });
    expect(syncIfOnline).toHaveBeenCalledTimes(1); // initial

    fire("background"); // ignored
    expect(syncIfOnline).toHaveBeenCalledTimes(1);
    fire("active"); // foreground → reconcile
    expect(syncIfOnline).toHaveBeenCalledTimes(2);

    stop();
    fire("active"); // unsubscribed → no more
    expect(syncIfOnline).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes the AppState listener on stop", () => {
    const engine = { syncIfOnline: vi.fn().mockResolvedValue(null) } as unknown as SyncEngine;
    const { appState, removed } = fakeAppState();
    const stop = startSyncLifecycle({ engine, connectivity: new ManualConnectivity(true), appState });
    stop();
    expect(removed.value).toBe(true);
  });
});
