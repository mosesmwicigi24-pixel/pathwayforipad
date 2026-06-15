import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv, agent, bearer } from "./helpers/app.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { IdentityService } from "../src/modules/identity/service.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
} from "../src/modules/identity/tokens.js";

const env = testEnv();
const svc = () => new IdentityService(testPool(), env);

describe("identity / auth", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("provisions a user on first OAuth login and reuses it on the second", async () => {
    const profile = { provider: "kingschat", sub: "kc-1", fullName: "Ada", email: "ada@example.com" };
    const first = await svc().loginWithOAuth(profile);
    expect(first.access_token).toBeTruthy();
    expect(first.refresh_token).toBeTruthy();

    const { rows: after1 } = await testPool().query("SELECT count(*)::int n FROM users");
    expect(after1[0].n).toBe(1);

    await svc().loginWithOAuth(profile); // same sub
    const { rows: after2 } = await testPool().query("SELECT count(*)::int n FROM users");
    expect(after2[0].n).toBe(1); // no duplicate
  });

  it("rotates refresh tokens and detects reuse by revoking the family (§5.3)", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });
    const issued = await issueRefreshToken(testPool(), user.user_id, env);

    // First rotation succeeds and yields a new token.
    const r1 = await rotateRefreshToken(testPool(), issued.token, env);
    expect(r1.userId).toBe(user.user_id);
    expect(r1.refresh.token).not.toBe(issued.token);

    // Reusing the ORIGINAL (now revoked) token is theft → throws and revokes family.
    await expect(rotateRefreshToken(testPool(), issued.token, env)).rejects.toThrow();

    // The previously-valid rotated token is now revoked too (family killed).
    await expect(rotateRefreshToken(testPool(), r1.refresh.token, env)).rejects.toThrow();
  });

  it("onboarding sets intake fields, derives congregation from the cell, and enrolls at L1", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Cell Z");
    // provision a bare SSO user (no cong yet)
    await svc().loginWithOAuth({ provider: "google", sub: "g-1", fullName: "Joon" });
    const { rows } = await testPool().query("SELECT user_id FROM users LIMIT 1");
    const userId = rows[0].user_id as string;

    const result = (await svc().onboard(userId, {
      date_of_birth: "2000-05-01",
      phone_number: "+254711111111",
      cell_group_id: cell,
      is_baptized: true,
    })) as { current_level: number; already_onboarded: boolean };

    expect(result.current_level).toBe(1);
    expect(result.already_onboarded).toBe(false);

    const { rows: u } = await testPool().query(
      "SELECT congregation_id, cell_group_id, is_minor FROM users WHERE user_id=$1",
      [userId],
    );
    expect(u[0].congregation_id).toBe(cong);
    expect(u[0].cell_group_id).toBe(cell);
    expect(u[0].is_minor).toBe(false);

    // Idempotent: a second onboarding returns the existing enrollment.
    const again = (await svc().onboard(userId, {
      date_of_birth: "2000-05-01",
      phone_number: "+254711111111",
      cell_group_id: cell,
      is_baptized: true,
    })) as { already_onboarded: boolean };
    expect(again.already_onboarded).toBe(true);
  });

  it("updateMe enforces optimistic concurrency (row_version)", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });

    const ok = (await svc().updateMe(user.user_id, {
      phone_number: "+254799999999",
      row_version: 1,
    })) as { row_version: number };
    expect(ok.row_version).toBe(2);

    // Stale version now fails.
    await expect(
      svc().updateMe(user.user_id, { timezone: "Africa/Lagos", row_version: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_STALE" });
  });

  it("updateMe persists the editable identity fields and they round-trip through getMe", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong, fullName: "Old Name" });

    await svc().updateMe(user.user_id, {
      full_name: "Moses Mwicigi",
      phone_number: "+254712345678",
      gender: "male",
      city: "Nairobi",
      country_code: "KE",
      date_of_birth: "1992-04-18",
      row_version: 1,
    });

    const me = (await svc().getMe(user.user_id)) as {
      profile: {
        full_name: string; phone_number: string; gender: string; city: string;
        country_code: string; date_of_birth: unknown; is_minor: boolean;
      };
    };
    expect(me.profile.full_name).toBe("Moses Mwicigi");
    expect(me.profile.phone_number).toBe("+254712345678");
    expect(me.profile.gender).toBe("male");
    expect(me.profile.city).toBe("Nairobi");
    expect(me.profile.country_code).toBe("KE");
    expect(me.profile.date_of_birth).toBeTruthy(); // was null before the update; pg returns a Date
    expect(me.profile.is_minor).toBe(false); // trigger recomputed from the new DOB
  });

  it("GET /me requires a token and returns the profile with a valid one", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong, fullName: "Mara" });

    await agent().get("/v1/me").expect(401);

    const res = await agent()
      .get("/v1/me")
      .set("Authorization", bearer({ sub: user.user_id, role: "Student", cong }))
      .expect(200);
    expect(res.body.profile.full_name).toBe("Mara");
  });

  // ---- Email + password login (POST /auth/login) ----
  async function makePwUser(email: string, password: string, status = "active") {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Admin", email });
    const argon2 = (await import("argon2")).default;
    const ph = await argon2.hash(password, { type: argon2.argon2id });
    await testPool().query("UPDATE users SET password_hash=$2, account_status=$3 WHERE user_id=$1", [u.user_id, ph, status]);
    return u.user_id;
  }

  it("signs in with the correct password and mints a session", async () => {
    await makePwUser("pw@dev.local", "s3cret-pass");
    const res = await agent().post("/v1/auth/login").send({ email: "pw@dev.local", password: "s3cret-pass" });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
  });

  it("rejects a wrong password and an unknown email with a generic 401", async () => {
    await makePwUser("pw2@dev.local", "right-pass");
    const wrong = await agent().post("/v1/auth/login").send({ email: "pw2@dev.local", password: "nope" });
    expect(wrong.status).toBe(401);
    const unknown = await agent().post("/v1/auth/login").send({ email: "ghost@dev.local", password: "whatever1" });
    expect(unknown.status).toBe(401);
  });

  it("blocks a suspended account (403)", async () => {
    await makePwUser("susp@dev.local", "right-pass", "suspended");
    const res = await agent().post("/v1/auth/login").send({ email: "susp@dev.local", password: "right-pass" });
    expect(res.status).toBe(403);
  });

  // ---- Self-service register (POST /auth/register) ----
  it("registers a new Student, mints a session, and the account can then log in", async () => {
    const reg = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Grace New", email: "grace@dev.local", password: "joinme1" });
    expect(reg.status).toBe(201);
    expect(reg.body.access_token).toBeTruthy();
    expect(reg.body.refresh_token).toBeTruthy();

    const { rows } = await testPool().query("SELECT role FROM users WHERE email=$1", ["grace@dev.local"]);
    expect(rows[0].role).toBe("Student"); // self-signup can only create a Student (§5.8)

    // The brand-new credential works at the login endpoint too.
    const login = await agent().post("/v1/auth/login").send({ email: "grace@dev.local", password: "joinme1" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email with 409 and a too-short password with 400", async () => {
    await agent().post("/v1/auth/register").send({ full_name: "Dup One", email: "dup@dev.local", password: "first123" });
    const dup = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Dup Two", email: "dup@dev.local", password: "second123" });
    expect(dup.status).toBe(409);

    const short = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Tiny", email: "tiny@dev.local", password: "12345" });
    expect(short.status).toBe(400);
  });

  // ---- Forgot / reset password ----
  it("forgot→reset rotates the password, burns the token, and revokes old sessions", async () => {
    const uid = await makePwUser("reset@dev.local", "old-pass-1");
    const old = await issueRefreshToken(testPool(), uid, env); // a live session before reset

    const forgot = await svc().requestPasswordReset({ email: "reset@dev.local" });
    expect(forgot.sent).toBe(true);
    const token = forgot.dev_token as string; // non-production exposes the raw token
    expect(token).toBeTruthy();

    await svc().resetPassword({ token, new_password: "brand-new-2" });

    // New password works, old one does not.
    await expect(
      svc().loginWithPassword({ email: "reset@dev.local", password: "brand-new-2" }),
    ).resolves.toMatchObject({ token_type: "Bearer" });
    await expect(
      svc().loginWithPassword({ email: "reset@dev.local", password: "old-pass-1" }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    // Token is single-use, and the pre-reset session was revoked.
    await expect(svc().resetPassword({ token, new_password: "again-333" })).rejects.toMatchObject({
      code: "UNPROCESSABLE",
    });
    await expect(rotateRefreshToken(testPool(), old.token, env)).rejects.toThrow();
  });

  it("forgot for an unknown email still reports sent (no enumeration) and issues no token", async () => {
    const res = await svc().requestPasswordReset({ email: "nobody@dev.local" });
    expect(res.sent).toBe(true);
    expect(res.dev_token).toBeUndefined();
  });
});
