// Online-first write that degrades to the offline queue (spec §1.7, §3.6).
// The direct API call runs FIRST and unchanged — so online behaviour is exactly
// as before. Only when that call fails purely because the device is offline do we
// enqueue the equivalent sync mutation to replay on reconnect. Real server errors
// (validation, permission) are rethrown so the UI still surfaces them.
import type { SyncEngine } from "./syncEngine.js";
import type { ConnectivityPort } from "../net/connectivity.js";

/** True when a request failed with no server response (offline / unreachable),
 *  as opposed to a 4xx/5xx the server actually returned. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { response?: unknown; request?: unknown; code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.response) return false; // server answered → a real error, not offline
  const code = e.code ?? "";
  if (code === "ERR_NETWORK" || code === "ECONNABORTED" || code === "ETIMEDOUT") return true;
  return e.request !== undefined || /network|timeout|offline/i.test(e.message ?? "");
}

export interface QueuedWrite {
  domain: string;
  op: string;
  payload: Record<string, unknown>;
}

export interface WriteThroughResult<T> {
  result?: T;
  queued: boolean;
}

export async function writeThrough<T>(args: {
  engine: SyncEngine;
  connectivity: ConnectivityPort;
  online: () => Promise<T>;
  queued: QueuedWrite;
}): Promise<WriteThroughResult<T>> {
  const { engine, connectivity, online, queued } = args;
  try {
    const result = await online();
    return { result, queued: false };
  } catch (err) {
    const offline = isNetworkError(err) || !(await connectivity.isOnline());
    if (offline) {
      await engine.enqueue(queued.domain, queued.op, queued.payload);
      return { queued: true };
    }
    throw err; // genuine server error — let the screen show it
  }
}
