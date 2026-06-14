// App-wide SyncEngine accessor — builds one engine from the live NuruApi
// (pull/push) + the shared LocalStore, so screens and the lifecycle loop share a
// single queue/cache. Lazily constructed so swapping the LocalStore (in-memory →
// AsyncStorage on device) before first use is honored.
import { SyncEngine } from "./syncEngine.js";
import { NuruApi } from "../api/client.js";
import { getLocalStore } from "../db/localStoreProvider.js";

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!engine) {
    engine = new SyncEngine(
      { pull: (body) => NuruApi.pull(body), push: (body) => NuruApi.push(body) },
      getLocalStore(),
    );
  }
  return engine;
}

/** Test/teardown hook: drop the memoized engine so the next get rebuilds it. */
export function resetSyncEngine(): void {
  engine = null;
}
