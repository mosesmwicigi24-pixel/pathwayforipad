// Dev-login — mints a real session in dev/test; never mounted in production.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, testEnv } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";

describe("POST /v1/auth/dev-login (dev only)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("mints a usable session for a seeded user in dev/test", async () => {
    const cong = await createCongregation();
    await createUser({ congregationId: cong, email: "dev+x@nuru.test", role: "Admin" });

    const res = await agent().post("/v1/auth/dev-login").send({ email: "dev+x@nuru.test" }).expect(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();

    // The minted token authenticates a real request.
    const me = await agent()
      .get("/v1/me")
      .set("Authorization", `Bearer ${res.body.access_token}`)
      .expect(200);
    expect(me.body.profile.email).toBe("dev+x@nuru.test");
  });

  it("404s an unknown user", async () => {
    const res = await agent().post("/v1/auth/dev-login").send({ email: "nobody@nuru.test" });
    expect(res.status).toBe(404);
  });

  it("is NOT mounted in production (404)", async () => {
    const env = { ...testEnv(), NODE_ENV: "production" } as ReturnType<typeof testEnv>;
    const pool = testPool();
    const prodApp = createApp({ env, db: { primary: pool, replica: pool }, log: pino({ level: "silent" }) });
    const res = await supertest(prodApp).post("/v1/auth/dev-login").send({ email: "dev+x@nuru.test" });
    expect(res.status).toBe(404);
  });
});
