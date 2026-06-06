// Unit tests for the read-through cache helper (§1.6). A tiny fake Redis lets us
// assert the loader runs once on miss, is skipped on hit, and that any Redis
// failure degrades gracefully to the source of truth (a cache outage must never
// break a request).
import { describe, it, expect, vi } from "vitest";
import { cacheGetSet, cacheInvalidate, cacheKeys } from "../src/cache.js";

type RedisLike = Parameters<typeof cacheGetSet>[0];

function fakeRedis(): { store: Map<string, string> } & NonNullable<RedisLike> {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, val: string) {
      store.set(key, val);
      return "OK";
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("cacheGetSet", () => {
  it("runs the loader directly when Redis is absent", async () => {
    const loader = vi.fn().mockResolvedValue({ v: 1 });
    const out = await cacheGetSet(undefined, "k", 60, loader);
    expect(out).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("misses then hits: loader runs once, second read is served from cache", async () => {
    const redis = fakeRedis();
    const loader = vi.fn().mockResolvedValue({ v: 42 });
    const first = await cacheGetSet(redis, "k", 60, loader);
    const second = await cacheGetSet(redis, "k", 60, loader);
    expect(first).toEqual({ v: 42 });
    expect(second).toEqual({ v: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces the next read to reload", async () => {
    const redis = fakeRedis();
    const loader = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });
    await cacheGetSet(redis, cacheKeys.levels, 60, loader);
    await cacheInvalidate(redis, cacheKeys.levels);
    const after = await cacheGetSet(redis, cacheKeys.levels, 60, loader);
    expect(after).toEqual({ v: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("falls back to the loader if Redis throws on read", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("down")),
      set: vi.fn().mockResolvedValue("OK"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = await cacheGetSet(redis, "k", 60, async () => ({ v: 7 }));
    expect(out).toEqual({ v: 7 });
  });
});
