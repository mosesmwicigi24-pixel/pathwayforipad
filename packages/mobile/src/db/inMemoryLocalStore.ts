// In-memory LocalStore — backs unit tests and first-run dev before the encrypted
// SQLite store is wired. Same contract as the SQLCipher implementation, so the
// sync engine and screens are agnostic to which is in use.
import type { PendingMutation } from "@nuru/shared";
import type { LocalStore, SyncRow } from "./localStore";

export class InMemoryLocalStore implements LocalStore {
  private queue: PendingMutation[] = [];
  private cursors = new Map<string, number>();
  private cache = new Map<string, Map<string, SyncRow>>();

  enqueueMutation(m: PendingMutation): Promise<void> {
    this.queue.push(m);
    return Promise.resolve();
  }

  pendingMutations(): Promise<PendingMutation[]> {
    return Promise.resolve([...this.queue].sort((a, b) => a.seq - b.seq));
  }

  clearMutations(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    this.queue = this.queue.filter((m) => !drop.has(m.mutation_id));
    return Promise.resolve();
  }

  getCursor(domain: string): Promise<number | undefined> {
    return Promise.resolve(this.cursors.get(domain));
  }

  setCursor(domain: string, value: number): Promise<void> {
    this.cursors.set(domain, value);
    return Promise.resolve();
  }

  cacheUpsert(domain: string, id: string, row: SyncRow): Promise<void> {
    const table = this.cache.get(domain) ?? new Map<string, SyncRow>();
    table.set(id, row);
    this.cache.set(domain, table);
    return Promise.resolve();
  }

  cacheDelete(domain: string, id: string): Promise<void> {
    this.cache.get(domain)?.delete(id);
    return Promise.resolve();
  }

  cacheList(domain: string): Promise<SyncRow[]> {
    return Promise.resolve([...(this.cache.get(domain)?.values() ?? [])]);
  }
}
