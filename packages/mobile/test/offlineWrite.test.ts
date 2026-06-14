import { describe, it, expect, vi } from "vitest";
import { writeThrough, isNetworkError } from "../src/sync/offlineWrite";
import { ManualConnectivity } from "../src/net/connectivity";
import type { SyncEngine } from "../src/sync/syncEngine";

function fakeEngine() {
  const enqueue = vi.fn().mockResolvedValue({ mutation_id: "m1" });
  return { engine: { enqueue } as unknown as SyncEngine, enqueue };
}
const queued = { domain: "prayer_entries", op: "upsert", payload: { entry_id: "e1" } };

describe("writeThrough", () => {
  it("runs the API online and does NOT queue", async () => {
    const { engine, enqueue } = fakeEngine();
    const online = vi.fn().mockResolvedValue({ ok: true });
    const res = await writeThrough({ engine, connectivity: new ManualConnectivity(true), online, queued });
    expect(res.queued).toBe(false);
    expect(res.result).toEqual({ ok: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues when the API fails with a network error", async () => {
    const { engine, enqueue } = fakeEngine();
    const online = vi.fn().mockRejectedValue({ request: {}, message: "Network Error" }); // no response
    const res = await writeThrough({ engine, connectivity: new ManualConnectivity(true), online, queued });
    expect(res.queued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith("prayer_entries", "upsert", queued.payload);
  });

  it("queues when connectivity reports offline (even without a thrown network error)", async () => {
    const { engine, enqueue } = fakeEngine();
    const online = vi.fn().mockRejectedValue({ message: "boom" });
    const res = await writeThrough({ engine, connectivity: new ManualConnectivity(false), online, queued });
    expect(res.queued).toBe(true);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("rethrows a real server error (4xx/5xx) and does NOT queue", async () => {
    const { engine, enqueue } = fakeEngine();
    const serverErr = { response: { status: 422, data: { error: { message: "bad" } } } };
    const online = vi.fn().mockRejectedValue(serverErr);
    await expect(writeThrough({ engine, connectivity: new ManualConnectivity(true), online, queued })).rejects.toBe(serverErr);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("isNetworkError distinguishes offline from server responses", () => {
    expect(isNetworkError({ request: {}, message: "Network Error" })).toBe(true);
    expect(isNetworkError({ code: "ECONNABORTED" })).toBe(true);
    expect(isNetworkError({ response: { status: 500 } })).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
