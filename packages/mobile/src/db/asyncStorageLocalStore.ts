// Persistent LocalStore (spec §1.7, §5.7) — durable across app restarts, backed
// by a KeyValueStore (AsyncStorage on device). The offline mutation queue, pull
// cursors, and the cached server rows survive a cold start, so queued writes
// replay on reconnect and screens render the last-known data offline.
//
// Key layout (all under the np: namespace):
//   np:queue                  → JSON array of PendingMutation (seq-ordered on read)
//   np:cursor:<domain>        → number
//   np:cache:<domain>:<id>    → JSON row
//
// Note: this is an unencrypted KV today; on a lost device the keychain still
// guards tokens (§5.7). A SQLCipher-backed store is the encryption follow-up and
// can replace this behind the same LocalStore interface.
import type { PendingMutation } from "@nuru/shared";
import type { LocalStore, SyncRow } from "./localStore.js";
import type { KeyValueStore } from "./keyValueStore.js";

const QUEUE_KEY = "np:queue";
const CURSOR_PREFIX = "np:cursor:";
const CACHE_PREFIX = "np:cache:";

export class AsyncStorageLocalStore implements LocalStore {
  constructor(private readonly kv: KeyValueStore) {}

  private async readQueue(): Promise<PendingMutation[]> {
    const raw = await this.kv.getItem(QUEUE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PendingMutation[];
    } catch {
      return [];
    }
  }
  private writeQueue(q: PendingMutation[]): Promise<void> {
    return this.kv.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  async enqueueMutation(m: PendingMutation): Promise<void> {
    const q = await this.readQueue();
    q.push(m);
    await this.writeQueue(q);
  }

  async pendingMutations(): Promise<PendingMutation[]> {
    const q = await this.readQueue();
    return [...q].sort((a, b) => a.seq - b.seq);
  }

  async clearMutations(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    const q = (await this.readQueue()).filter((m) => !drop.has(m.mutation_id));
    await this.writeQueue(q);
  }

  async getCursor(domain: string): Promise<number | undefined> {
    const raw = await this.kv.getItem(CURSOR_PREFIX + domain);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  setCursor(domain: string, value: number): Promise<void> {
    return this.kv.setItem(CURSOR_PREFIX + domain, String(value));
  }

  cacheUpsert(domain: string, id: string, row: SyncRow): Promise<void> {
    return this.kv.setItem(`${CACHE_PREFIX}${domain}:${id}`, JSON.stringify(row));
  }

  cacheDelete(domain: string, id: string): Promise<void> {
    return this.kv.removeItem(`${CACHE_PREFIX}${domain}:${id}`);
  }

  async cacheList(domain: string): Promise<SyncRow[]> {
    const prefix = `${CACHE_PREFIX}${domain}:`;
    const keys = (await this.kv.getAllKeys()).filter((k) => k.startsWith(prefix));
    const rows: SyncRow[] = [];
    for (const k of keys) {
      const raw = await this.kv.getItem(k);
      if (raw) {
        try {
          rows.push(JSON.parse(raw) as SyncRow);
        } catch {
          /* skip corrupt row */
        }
      }
    }
    return rows;
  }
}
