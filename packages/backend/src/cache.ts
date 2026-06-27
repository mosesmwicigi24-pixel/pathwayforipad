// Tiny read-through cache over Redis (spec §1.6). Used for hot, mostly-static
// reads (the curriculum catalog and published lesson bodies). Every operation is
// best-effort: if Redis is absent or errors, we transparently fall back to the
// loader so a cache outage can never take the API down. Per-user / gated data is
// deliberately NOT cached here — only content that is identical for every reader.
import type Redis from "ioredis";

/** Get `key` from cache, or run `loader`, store it with a TTL, and return it. */
export async function cacheGetSet<T>(
  redis: Redis | undefined,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  if (!redis) return loader();
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    // Cache read failed (down / network) — fall through to the source of truth.
  }
  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failed — the value is still returned to the caller.
  }
  return value;
}

/** Best-effort delete of one or more cache keys (no-op without Redis). */
export async function cacheInvalidate(redis: Redis | undefined, ...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // Stale entries will expire on their TTL even if the explicit bust fails.
  }
}

// --- Key builders: one place so producers and invalidators never drift. -------
export const cacheKeys = {
  levels: "cache:levels",
  moduleContent: (moduleId: string): string => `cache:module:content:${moduleId}`,
  // Scripture is reader-identical and immutable for a given ref+version+language, so
  // it's safe to cache for a long time (avoids the external YouVersion round-trip).
  scripture: (ref: string, version: string, language: string): string => `cache:scripture:${version}:${language}:${ref}`,
};
