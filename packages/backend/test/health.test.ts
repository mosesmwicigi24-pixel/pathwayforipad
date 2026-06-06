// Liveness + readiness probes (§4.7).
import { describe, it, expect } from "vitest";
import { agent } from "./helpers/app.js";

describe("health & readiness", () => {
  it("/healthz reports liveness", async () => {
    const res = await agent().get("/healthz").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("/readyz pings the database", async () => {
    const res = await agent().get("/readyz").expect(200);
    expect(res.body.status).toBe("ready");
  });
});
