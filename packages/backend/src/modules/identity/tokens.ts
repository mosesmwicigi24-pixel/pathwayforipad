// Token model (spec §5.3): a short-lived access JWT (user id, role, congregation
// scope) + a long-lived rotating refresh token stored only as a SHA-256 hash.
// Rotation issues a new token and invalidates the old; presenting an
// already-used (revoked) token revokes the entire family — theft detection.
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { UserRole } from "@nuru/shared";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../http/errors.js";
import { many, maybeOne } from "../../db/db.js";

export interface AccessClaims {
  sub: string; // user_id
  role: UserRole;
  cong: string; // congregation_id
  mfa?: boolean; // a second factor was verified for this token (§5.3 step-up)
  mfa_at?: number; // unix seconds of that verification (freshness for re-prompt)
}

export function signAccessToken(env: Env, claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SIGNING_KEY, {
    algorithm: "HS256",
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

/**
 * Short-lived (5 min) login-MFA challenge token. Issued after the password step
 * when 2FA is on; the holder must present a valid TOTP / recovery code to
 * exchange it for a real session. It carries no role/scope and grants no access
 * on its own — purpose-tagged so it can't be replayed as an access token.
 */
export function signMfaChallenge(env: Env, userId: string): string {
  return jwt.sign({ sub: userId, purpose: "mfa_login" }, env.JWT_SIGNING_KEY, {
    algorithm: "HS256",
    expiresIn: 300,
  });
}

export function verifyMfaChallenge(env: Env, token: string): string {
  try {
    const decoded = jwt.verify(token, env.JWT_SIGNING_KEY, { algorithms: ["HS256"] }) as {
      sub?: string;
      purpose?: string;
    };
    if (decoded.purpose !== "mfa_login" || !decoded.sub) throw new Error("bad challenge");
    return decoded.sub;
  } catch {
    throw new ApiError("AUTH_REQUIRED", "Invalid or expired MFA challenge");
  }
}

export function verifyAccessToken(env: Env, token: string): AccessClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_SIGNING_KEY, { algorithms: ["HS256"] });
    return decoded as AccessClaims;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new ApiError(expired ? "TOKEN_EXPIRED" : "AUTH_REQUIRED", "Invalid or expired access token");
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface IssuedRefresh {
  token: string; // raw token returned to the client (never stored)
  familyId: string;
}

/** Issue a refresh token, optionally continuing an existing rotation family. */
export async function issueRefreshToken(
  pool: Pool,
  userId: string,
  env: Env,
  opts: { familyId?: string; deviceId?: string | null } = {},
): Promise<IssuedRefresh> {
  const raw = `${randomUUID()}.${randomBytes(32).toString("hex")}`;
  const familyId = opts.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, device_id, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, familyId, sha256(raw), opts.deviceId ?? null, expiresAt],
  );
  return { token: raw, familyId };
}

interface RefreshRow {
  token_id: string;
  user_id: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Rotate a refresh token. Returns the user_id + new family on success. Throws
 * AUTH_REQUIRED on an unknown/expired token, and — critically — on reuse of an
 * already-revoked token it revokes the whole family before throwing (§5.3).
 */
export async function rotateRefreshToken(
  pool: Pool,
  rawToken: string,
  env: Env,
): Promise<{ userId: string; refresh: IssuedRefresh }> {
  const row = await maybeOne<RefreshRow>(
    pool,
    `SELECT token_id, user_id, family_id, expires_at, revoked_at
       FROM refresh_tokens WHERE token_hash = $1`,
    [sha256(rawToken)],
  );
  if (!row) throw new ApiError("AUTH_REQUIRED", "Unknown refresh token");

  if (row.revoked_at !== null) {
    // Reuse of a rotated/revoked token => probable theft. Revoke the family.
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [row.family_id],
    );
    throw new ApiError("AUTH_REQUIRED", "Refresh token reuse detected; session revoked");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError("AUTH_REQUIRED", "Refresh token expired");
  }

  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_id = $1`, [row.token_id]);
  const refresh = await issueRefreshToken(pool, row.user_id, env, { familyId: row.family_id });
  return { userId: row.user_id, refresh };
}

/** Revoke an entire refresh-token family (logout). */
export async function revokeFamily(pool: Pool, rawToken: string): Promise<void> {
  const rows = await many<{ family_id: string }>(
    pool,
    `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
    [sha256(rawToken)],
  );
  const familyId = rows[0]?.family_id;
  if (familyId) {
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }
}
