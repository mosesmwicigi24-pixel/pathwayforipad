// Sync lifecycle (spec §1.7) — reconcile at the moments that matter: right after
// startup/login, and whenever the app returns to the foreground (a cheap proxy
// for "connectivity may have changed"). syncIfOnline() no-ops when offline, so
// these triggers are safe to fire liberally. AppState is injected so this is
// unit-testable without react-native.
import type { SyncEngine } from "./syncEngine.js";
import type { ConnectivityPort } from "../net/connectivity.js";

export interface AppStateLike {
  addEventListener(type: "change", handler: (state: string) => void): { remove(): void };
}

export interface SyncLifecycleDeps {
  engine: SyncEngine;
  connectivity: ConnectivityPort;
  appState: AppStateLike;
  onError?: (err: unknown) => void;
}

/** Start the background sync loop. Returns an unsubscribe to stop it. */
export function startSyncLifecycle(deps: SyncLifecycleDeps): () => void {
  const { engine, connectivity, appState, onError } = deps;
  const run = (): void => {
    engine.syncIfOnline(connectivity).catch((e) => onError?.(e));
  };
  run(); // initial reconcile
  const sub = appState.addEventListener("change", (state) => {
    if (state === "active") run();
  });
  return () => sub.remove();
}
