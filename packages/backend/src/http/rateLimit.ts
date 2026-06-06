// Token-bucket rate limiting (spec §5.8). An injectable store (in-memory for dev/
// tests, Redis-backed when REDIS_URL is set) keeps it horizontally correct. The
// middleware sets X-RateLimit-* + Retry-After and returns 429 RATE_LIMITED.
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Redis } from "ioredis";
import { ApiError } from "./errors.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSec: number; // unix seconds when the bucket is full again
  retryAfterSec: number;
}

export interface RateLimitStore {
  consume(key: string, capacity: number, refillPerSec: number, cost?: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  consume(key: string, capacity: number, refillPerSec: number, cost = 1): Promise<RateLimitResult> {
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, ts: now };
    const elapsed = Math.max(0, now - b.ts) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.ts = now;
    const allowed = b.tokens >= cost;
    if (allowed) b.tokens -= cost;
    this.buckets.set(key, b);
    return Promise.resolve(toResult(allowed, b.tokens, capacity, refillPerSec, cost, now));
  }
}

const BUCKET_LUA = `
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local capacity = tonumber(ARGV[1]); local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3]); local cost = tonumber(ARGV[4])
local tokens = tonumber(data[1]); local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill * 1000) + 1000)
return { allowed, tostring(tokens) }`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}
  async consume(key: string, capacity: number, refillPerSec: number, cost = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const res = (await this.redis.eval(
      BUCKET_LUA,
      1,
      `rl:${key}`,
      String(capacity),
      String(refillPerSec),
      String(now),
      String(cost),
    )) as [number, string];
    return toResult(res[0] === 1, Number(res[1]), capacity, refillPerSec, cost, now);
  }
}

function toResult(
  allowed: boolean,
  tokens: number,
  capacity: number,
  refillPerSec: number,
  cost: number,
  now: number,
): RateLimitResult {
  const deficit = allowed ? 0 : cost - tokens;
  return {
    allowed,
    remaining: Math.max(0, Math.floor(tokens)),
    limit: capacity,
    resetSec: Math.ceil((now + ((capacity - tokens) / refillPerSec) * 1000) / 1000),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil(deficit / refillPerSec)),
  };
}

/** Key by the authenticated user (bearer hash) when present, else by IP. */
export function byUserOrIp(req: Request): string {
  const auth = req.header("authorization");
  if (auth?.startsWith("Bearer ")) return `u:${createHash("sha256").update(auth.slice(7)).digest("hex").slice(0, 16)}`;
  return `ip:${req.ip ?? "anon"}`;
}

export function byIp(req: Request): string {
  return `ip:${req.ip ?? "anon"}`;
}

export interface RateLimitOptions {
  store: RateLimitStore;
  name: string;
  capacity: number;
  refillPerSec: number;
  keyBy?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  const keyBy = opts.keyBy ?? byIp;
  return (req: Request, res: Response, next: NextFunction): void => {
    void opts.store.consume(`${opts.name}:${keyBy(req)}`, opts.capacity, opts.refillPerSec).then((r) => {
      res.setHeader("X-RateLimit-Limit", String(r.limit));
      res.setHeader("X-RateLimit-Remaining", String(r.remaining));
      res.setHeader("X-RateLimit-Reset", String(r.resetSec));
      if (!r.allowed) {
        res.setHeader("Retry-After", String(r.retryAfterSec));
        next(new ApiError("RATE_LIMITED", "Too many requests; slow down"));
        return;
      }
      next();
    }, next);
  };
}
