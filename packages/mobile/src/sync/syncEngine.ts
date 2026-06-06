// Offline sync engine (spec §1.7, §3.6). Wraps the two server flows around the
// local store:
//   • enqueue — append an intent to the durable pending-mutations queue
//   • push    — replay the queue in seq order; drop applied/duplicate/rejected
//   • pull     — cursor-driven delta; cache upserts, apply tombstones, advance cursors
// The queue is the system of record for in-flight writes; the UI reads the local
// cache, so the member never waits on the network.
import type { PendingMutation, SyncPullResponse, SyncPushResponse } from "@nuru/shared";
import type { LocalStore } from "../db/localStore";
import { uuidv4 } from "../util/uuid";
import { MONEY_DOMAINS, type ConnectivityPort } from "../net/connectivity";

export interface SyncApi {
  pull(body: { device_id?: string; cursors: Record<string, number> }): Promise<SyncPullResponse>;
  push(body: { device_id?: string; mutations: PendingMutation[] }): Promise<SyncPushResponse>;
}

// Pullable domains → primary-id field, mirroring the backend's PULL_DOMAINS.
const ID_FIELD: Record<string, string> = {
  modules: "module_id",
  module_progress: "progress_id",
  quiz_attempts: "attempt_id",
  level_exam_attempts: "exam_attempt_id",
  enrollments: "enrollment_id",
};

export class SyncEngine {
  constructor(
    private readonly api: SyncApi,
    private readonly store: LocalStore,
    private readonly deviceId?: string,
    private readonly genId: () => string = uuidv4,
  ) {}

  /** Append an offline mutation with the next monotonic per-device seq. */
  async enqueue(domain: string, op: string, payload: Record<string, unknown>): Promise<PendingMutation> {
    // Money is never queued offline (§5.6) — refuse it at the source.
    if (MONEY_DOMAINS.has(domain)) {
      throw new Error("Money is never queued offline (§5.6); the giving flow requires connectivity.");
    }
    const pending = await this.store.pendingMutations();
    const seq = pending.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
    const mutation: PendingMutation = {
      mutation_id: this.genId(),
      seq,
      domain,
      op,
      payload,
      status: "pending",
    };
    await this.store.enqueueMutation(mutation);
    return mutation;
  }

  /** Replay the queue. Returns the server results, or null if nothing was queued. */
  async push(): Promise<SyncPushResponse | null> {
    const mutations = await this.store.pendingMutations();
    if (mutations.length === 0) return null;
    const res = await this.api.push({ ...(this.deviceId ? { device_id: this.deviceId } : {}), mutations });
    // applied + duplicate + rejected all leave the queue (§3.6: rejected are
    // surfaced to the user and removed; duplicates dropped silently).
    await this.store.clearMutations(res.results.map((r) => r.mutation_id));
    return res;
  }

  /** Delta pull: cache changed rows, apply tombstones, advance cursors. */
  async pull(): Promise<SyncPullResponse> {
    const cursors: Record<string, number> = {};
    for (const domain of Object.keys(ID_FIELD)) {
      const c = await this.store.getCursor(domain);
      if (c !== undefined) cursors[domain] = c;
    }
    const res = await this.api.pull({ ...(this.deviceId ? { device_id: this.deviceId } : {}), cursors });

    for (const [domain, changes] of Object.entries(res.changes)) {
      const idField = ID_FIELD[domain] ?? "id";
      for (const change of changes) {
        await this.store.cacheUpsert(domain, String(change.row[idField]), change.row);
      }
    }
    for (const [domain, ids] of Object.entries(res.tombstones)) {
      for (const id of ids) await this.store.cacheDelete(domain, id);
    }
    for (const [domain, cursor] of Object.entries(res.cursors)) {
      await this.store.setCursor(domain, cursor);
    }
    return res;
  }

  /** Convenience: push local work, then pull the latest (a full reconcile). */
  async sync(): Promise<{ push: SyncPushResponse | null; pull: SyncPullResponse }> {
    const pushed = await this.push();
    const pulled = await this.pull();
    return { push: pushed, pull: pulled };
  }

  /** Reconcile only when online; queue silently otherwise (§1.7). */
  async syncIfOnline(
    conn: ConnectivityPort,
  ): Promise<{ push: SyncPushResponse | null; pull: SyncPullResponse } | null> {
    if (!(await conn.isOnline())) return null;
    return this.sync();
  }
}
