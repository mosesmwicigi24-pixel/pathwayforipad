// Member 2FA login gating (§5.3): once a member enables a second factor, the
// password step alone returns a challenge — a real session is only minted after
// a valid TOTP or one-time recovery code. Also covers disable (which requires a
// code) and that recovery codes are single-use.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { IdentityService, type MfaChallenge, type SessionTokens } from "../src/modules/identity/service.js";
import { hashPassword } from "../src/modules/identity/passwords.js";
import { totp } from "../src/modules/identity/totp.js";

const env = testEnv();
const svc = () => new IdentityService(testPool(), env);
const PASSWORD = "Sup3r-Secret!";

async function makeMember(email: string): Promise<string> {
  const cong = await createCongregation();
  const user = await createUser({ congregationId: cong, email });
  await testPool().query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [
    user.user_id,
    await hashPassword(PASSWORD),
  ]);
  return user.user_id;
}

/** Enroll + verify so the account has 2FA on; returns the TOTP secret. */
async function enable2fa(userId: string): Promise<{ secret: string; recovery: string[] }> {
  const { secret } = await svc().enrollMfa(userId);
  const res = await svc().verifyMfa(userId, totp(secret));
  return { secret, recovery: res.recovery_codes ?? [] };
}

const isChallenge = (r: SessionTokens | MfaChallenge): r is MfaChallenge =>
  (r as MfaChallenge).mfa_required === true;

describe("2FA login gating", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns a challenge (not a session) when 2FA is on, then a session after a TOTP code", async () => {
    const userId = await makeMember("a@nuru.test");
    const { secret, recovery } = await enable2fa(userId);
    expect(recovery).toHaveLength(10);
    expect(recovery[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);

    const login = await svc().loginWithPassword({ email: "a@nuru.test", password: PASSWORD });
    expect(isChallenge(login)).toBe(true);
    if (!isChallenge(login)) throw new Error("expected challenge");

    const session = await svc().loginCompleteMfa(login.mfa_token, totp(secret));
    expect(session.access_token).toBeTruthy();
    expect(session.refresh_token).toBeTruthy();
  });

  it("accepts a recovery code once and then consumes it", async () => {
    const userId = await makeMember("b@nuru.test");
    const { recovery } = await enable2fa(userId);
    const code = recovery[0]!;

    const first = await svc().loginWithPassword({ email: "b@nuru.test", password: PASSWORD });
    if (!isChallenge(first)) throw new Error("expected challenge");
    const session = await svc().loginCompleteMfa(first.mfa_token, code);
    expect(session.access_token).toBeTruthy();

    // Re-using the same recovery code fails.
    const second = await svc().loginWithPassword({ email: "b@nuru.test", password: PASSWORD });
    if (!isChallenge(second)) throw new Error("expected challenge");
    await expect(svc().loginCompleteMfa(second.mfa_token, code)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects a wrong code at the challenge step", async () => {
    await makeMember("c@nuru.test");
    const userId = (await testPool().query("SELECT user_id FROM users WHERE email='c@nuru.test'")).rows[0].user_id;
    await enable2fa(userId);
    const login = await svc().loginWithPassword({ email: "c@nuru.test", password: PASSWORD });
    if (!isChallenge(login)) throw new Error("expected challenge");
    await expect(svc().loginCompleteMfa(login.mfa_token, "000000")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("disable requires a valid code, then login returns a session directly", async () => {
    const userId = await makeMember("d@nuru.test");
    const { secret } = await enable2fa(userId);

    await expect(svc().disableMfa(userId, "000000")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    const off = await svc().disableMfa(userId, totp(secret));
    expect(off.mfa_enabled).toBe(false);

    const login = await svc().loginWithPassword({ email: "d@nuru.test", password: PASSWORD });
    expect(isChallenge(login)).toBe(false);
    if (isChallenge(login)) throw new Error("expected session");
    expect(login.access_token).toBeTruthy();
  });

  it("an account without 2FA logs in directly", async () => {
    await makeMember("e@nuru.test");
    const login = await svc().loginWithPassword({ email: "e@nuru.test", password: PASSWORD });
    expect(isChallenge(login)).toBe(false);
  });
});
