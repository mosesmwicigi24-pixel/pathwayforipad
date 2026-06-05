// Encrypted local store interface (spec §1.3, §5.7). Backed by SQLCipher (or a
// platform equivalent); cached curriculum, progress, and the pending_mutations
// queue are protected if a device is lost. This is the interface the rest of the
// app codes against; the concrete SQLite implementation is added as features land.
import type { PendingMutation } from "@nuru/shared";

export interface LocalStore {
  /** Append an offline mutation to the durable queue (§1.7). */
  enqueueMutation(m: PendingMutation): Promise<void>;
  /** Read the queue head in seq order for replay (§3.6). */
  pendingMutations(): Promise<PendingMutation[]>;
  /** Remove applied/duplicate mutations after a successful push. */
  clearMutations(ids: string[]): Promise<void>;
  /** Per-domain pull cursor used by sync (§3.6). */
  getCursor(domain: string): Promise<number | undefined>;
  setCursor(domain: string, value: number): Promise<void>;
}
