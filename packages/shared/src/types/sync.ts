// Offline batch-sync contract types — the wire shapes for §3.6 / §1.7.
// These are deliberately transport-level; the server is authoritative on apply.

import type { UUID } from "./models.js";

export type SyncDomain =
  | "modules"
  | "module_progress"
  | "engagement"
  | "attendance"
  | "interaction_events"
  | "products"
  | string;

// --- Pull (delta): server → client ---
export interface SyncPullRequest {
  device_id: UUID;
  cursors: Record<SyncDomain, number>;
}

export interface SyncChange<Row = Record<string, unknown>> {
  op: "upsert" | "delete";
  row: Row;
}

export interface SyncPullResponse {
  changes: Record<SyncDomain, SyncChange[]>;
  tombstones: Record<SyncDomain, string[]>;
  cursors: Record<SyncDomain, number>;
}

// --- Push (replay): client → server ---
export type MutationStatus = "pending" | "acked" | "applied" | "rejected" | "duplicate";

export interface PendingMutation<Payload = Record<string, unknown>> {
  mutation_id: UUID; // client-generated idempotency key
  seq: number; // monotonic per-device order
  domain: SyncDomain;
  op: string; // 'complete' | 'scan' | 'tick' ...
  payload: Payload;
  status?: MutationStatus;
}

export interface SyncPushRequest {
  device_id: UUID;
  mutations: PendingMutation[];
}

export interface MutationResult {
  mutation_id: UUID;
  status: "applied" | "duplicate" | "rejected";
  server_version?: number;
  code?: string; // e.g. GATE_LOCKED on rejection
  detail?: string;
  note?: string;
}

export interface SyncPushResponse {
  results: MutationResult[];
}
