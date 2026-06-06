// Admin step-up MFA (§5.3): TOTP correctness (RFC 6238 vectors), the
// enroll → verify → elevated-token service flow, and the requireStepUp guard.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { IdentityService } from "../src/modules/identity/service.js";
import { verifyAccessToken } from "../src/modules/identity/tokens.js";
import { totp, verifyTotp } from "../src/modules/identity/totp.js";
import { requireStepUp } from "../src/http/auth.js";

const env = testEnv();
const svc = () => new IdentityService(testPool(), env);

// RFC 6238 Appendix B, SHA1 seed "12345678901234567890" (base32 below).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP (RFC 6238 vectors)", () => {
  it("matches the published 6-digit codes", () => {
    expect(totp(RFC_SECRET, { time: 59 })).toBe("287082");
    expect(totp(RFC_SECRET, { time: 1111111111 })).toBe("050471");
    expect(totp(RFC_SECRET, { time: 1234567890 })).toBe("005924");
  });

  it("verifies within the time window and rejects wrong codes", () => {
    expect(verifyTotp(RFC_SECRET, "287082", { time: 59 })).toBe(true);
    expect(verifyTotp(RFC_SECRET, "287082", { time: 59 + 30 })).toBe(true); // +1 step tolerated
    expect(verifyTotp(RFC_SECRET, "000000", { time: 59 })).toBe(false);
    expect(verifyTotp(RFC_SECRET, "28708", { time: 59 })).toBe(false); // wrong length
  });
});

describe("MFA enroll/verify (§5.3)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("enrolls, then verifies a live code and issues an MFA-elevated token", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });

    const { secret } = await svc().enrollMfa(user.user_id);
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    // Not enabled until first verify.
    const before = await testPool().query("SELECT mfa_enabled FROM users WHERE user_id=$1", [user.user_id]);
    expect(before.rows[0].mfa_enabled).toBe(false);

    const code = totp(secret);
    const elevated = await svc().verifyMfa(user.user_id, code);
    expect(elevated.mfa_enabled).toBe(true);

    const claims = verifyAccessToken(env, elevated.access_token);
    expect(claims.mfa).toBe(true);
    expect(typeof claims.mfa_at).toBe("number");

    const after = await testPool().query("SELECT mfa_enabled FROM users WHERE user_id=$1", [user.user_id]);
    expect(after.rows[0].mfa_enabled).toBe(true);
  });

  it("rejects an invalid code", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });
    await svc().enrollMfa(user.user_id);
    await expect(svc().verifyMfa(user.user_id, "000000")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("requireStepUp guard (§5.3)", () => {
  const run = (principal: unknown) => {
    const next = vi.fn();
    requireStepUp(900)({ principal } as unknown as Request, {} as Response, next as unknown as NextFunction);
    return next;
  };
  const now = () => Math.floor(Date.now() / 1000);

  it("passes a fresh MFA principal", () => {
    const next = run({ userId: "u", role: "SuperAdmin", congregationId: "c", mfa: true, mfaAt: now() });
    expect(next).toHaveBeenCalledWith(); // no error
  });

  it("blocks a principal without MFA", () => {
    const next = run({ userId: "u", role: "SuperAdmin", congregationId: "c" });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("blocks a stale MFA verification", () => {
    const next = run({ userId: "u", role: "SuperAdmin", congregationId: "c", mfa: true, mfaAt: now() - 1000 });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
});
