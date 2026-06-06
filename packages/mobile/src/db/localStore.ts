// Encrypted local store interface (spec §1.3, §5.7). Backed by SQLCipher (or a
// platform equivalent); cached curriculum, progress, and the pending_mutations
// queue are protected if a device is lost. This is the interface the rest of the
// app codes against; the concrete SQLite implementation (sqliteLocalStore) is
// added per platform, and inMemoryLocalStore backs tests + first-run dev.
import type { PendingMutation } from "@nuru/shared";

export type SyncRow = Record<string, unknown>;

export interface LocalStore {
  // --- Offline mutation queue (§1.7) ---
  /** Append an offline mutation to the durable queue. */
  enqueueMutation(m: PendingMutation): Promise<void>;
  /** Read the queue head in seq order for replay (§3.6). */
  pendingMutations(): Promise<PendingMutation[]>;
  /** Remove applied/duplicate/rejected mutations after a push. */
  clearMutations(ids: string[]): Promise<void>;

  // --- Per-domain pull cursors (§3.6) ---
  getCursor(domain: string): Promise<number | undefined>;
  setCursor(domain: string, value: number): Promise<void>;

  // --- Local row cache: the offline-readable copy of server domains (§1.3) ---
  /** Upsert a server row into the local cache, keyed by its primary id. */
  cacheUpsert(domain: string, id: string, row: SyncRow): Promise<void>;
  /** Remove a row the server tombstoned. */
  cacheDelete(domain: string, id: string): Promise<void>;
  /** All cached rows for a domain (what screens render offline). */
  cacheList(domain: string): Promise<SyncRow[]>;
}
