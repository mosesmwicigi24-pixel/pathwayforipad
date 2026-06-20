// Token-bucket rate limiting (§5.8) — over-limit returns 429 with Retry-After,
// and the bucket refills over (injected) time. Pure middleware test, no DB.
import { describe, it, expect } from "vitest";
import express from "express";
import supertest from "supertest";
import { InMemoryRateLimitStore, rateLimit } from "../src/http/rateLimit.js";
import { ApiError } from "../src/http/errors.js";

function appWithClock(clock: { t: number }) {
  const store = new InMemoryRateLimitStore(() => clock.t);
  const app = express();
  app.use(rateLimit({ store, name: "test", capacity: 2, refillPerSec: 1, keyBy: () => "fixed" }));
  app.get("/x", (_req, res) => res.json({ ok: true }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof ApiError ? err.status : 500;
    res.status(status).json({ code: err instanceof ApiError ? err.code : "INTERNAL" });
  });
  return supertest(app);
}

describe("rateLimit middleware (§5.8)", () => {
  it("allows up to capacity, then 429s with headers, then refills over time", async () => {
    const clock = { t: 1_000_000 };
    const api = appWithClock(clock);

    const a = await api.get("/x").expect(200);
    expect(a.headers["x-ratelimit-limit"]).toBe("2");
    expect(a.headers["x-ratelimit-remaining"]).toBe("1");

    await api.get("/x").expect(200); // remaining -> 0

    const blocked = await api.get("/x").expect(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(Number(blocked.headers["x-ratelimit-reset"])).toBeGreaterThan(0);

    // Advance 2s -> 2 tokens refill (refillPerSec=1) -> allowed again.
    clock.t += 2_000;
    await api.get("/x").expect(200);
  });

  it("skip() lets a request bypass the bucket entirely", async () => {
    const store = new InMemoryRateLimitStore(() => 1_000_000);
    const app = express();
    // Only POSTs count against the bucket; GETs skip (mirrors the /v1/giving fix).
    app.use(rateLimit({ store, name: "pay", capacity: 1, refillPerSec: 0, keyBy: () => "fixed", skip: (req) => req.method === "GET" }));
    app.get("/x", (_req, res) => res.json({ ok: true }));
    app.post("/x", (_req, res) => res.json({ ok: true }));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err instanceof ApiError ? err.status : 500).json({ code: err instanceof ApiError ? err.code : "INTERNAL" });
    });
    const api = supertest(app);
    // Many GETs never 429 even though the bucket holds 1 token and never refills.
    for (let i = 0; i < 5; i++) await api.get("/x").expect(200);
    // The single write token is still there; the second write 429s.
    await api.post("/x").expect(200);
    await api.post("/x").expect(429);
  });
});
