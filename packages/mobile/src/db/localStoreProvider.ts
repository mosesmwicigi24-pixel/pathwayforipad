// App-wide LocalStore accessor (spec §1.3, §5.7). One shared cache instance the
// screens and the SyncEngine read/write — mirrors the auth vault pattern: default
// to the in-memory store (import-safe in tests), swap to a SQLCipher-backed store
// on device with setLocalStore() before first use.
import type { LocalStore } from "./localStore.js";
import { InMemoryLocalStore } from "./inMemoryLocalStore.js";

let current: LocalStore = new InMemoryLocalStore();

export function getLocalStore(): LocalStore {
  return current;
}

export function setLocalStore(store: LocalStore): void {
  current = store;
}
