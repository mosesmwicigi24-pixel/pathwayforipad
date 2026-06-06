// Readiness probe (§4.7) — /readyz returns 503 when a dependency is unreachable
// and 200 when the DB answers. Uses fake pools so no real connection is needed.
import { describe, it, expect } from "vitest";
import { pino } from "pino";
import supertest from "supertest";
import { createApp } from "../src/http/app.js";
import { testEnv } from "./helpers/app.js";

const fakePool = (impl: () => Promise<unknown>) => ({ query: impl }) as never;

function appWith(primaryQuery: () => Promise<unknown>) {
  const pool = fakePool(primaryQuery);
  return supertest(
    createApp({ env: testEnv(), db: { primary: pool, replica: pool }, log: pino({ level: "silent" }) }),
  );
}

describe("/readyz dependency probe (§4.7)", () => {
  it("returns 200 when the database answers", async () => {
    const res = await appWith(() => Promise.resolve({ rows: [{ "?column?": 1 }] })).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("returns 503 when the database is down", async () => {
    const res = await appWith(() => Promise.reject(new Error("connection refused"))).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("keeps liveness (/healthz) up regardless of dependencies", async () => {
    const res = await appWith(() => Promise.reject(new Error("down"))).get("/healthz");
    expect(res.status).toBe(200);
  });
});
