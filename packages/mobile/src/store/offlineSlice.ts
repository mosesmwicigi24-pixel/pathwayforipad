// offlineSlice (spec §1.3, §1.7): the in-memory view of the local pending_mutations
// queue. Mutations are intent records with a client-generated UUID and a monotonic
// per-device seq; they are replayed in order when connectivity returns and never
// reordered, so causal dependencies (complete module 3 → then module 4) hold.
// Persistence is the encrypted SQLite table in src/db; this slice mirrors its head.
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PendingMutation } from "@nuru/shared";

export interface OfflineState {
  online: boolean;
  nextSeq: number;
  queue: PendingMutation[];
}

const initialState: OfflineState = { online: true, nextSeq: 1, queue: [] };

const offlineSlice = createSlice({
  name: "offline",
  initialState,
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
    },
    enqueue(state, action: PayloadAction<Omit<PendingMutation, "seq" | "status">>) {
      state.queue.push({ ...action.payload, seq: state.nextSeq, status: "pending" });
      state.nextSeq += 1;
    },
    // Drop applied/duplicate mutations after a successful push (§3.6).
    resolve(state, action: PayloadAction<string[]>) {
      const done = new Set(action.payload);
      state.queue = state.queue.filter((m) => !done.has(m.mutation_id));
    },
  },
});

export const { setOnline, enqueue, resolve } = offlineSlice.actions;
export const offlineReducer = offlineSlice.reducer;
