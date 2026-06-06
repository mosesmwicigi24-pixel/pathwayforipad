// Redis client (spec §1.6) — sessions/cache/rate-limit. Created only when
// REDIS_URL is set; otherwise the app/worker run Redis-less (in-memory fallbacks).
import Redis from "ioredis";
import type { Env } from "./config/env.js";

export function buildRedis(env: Env): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
}
