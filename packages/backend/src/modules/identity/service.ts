// Identity service (spec §1.5, §3.3, §5.3). Provisioning from OAuth, profile
// read/update with optimistic concurrency, and the onboarding intake that
// instantiates the enrollment at Level 1 · Module 1.
import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../http/errors.js";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  type AccessClaims,
} from "./tokens.js";
import type { OAuthProfile } from "./oauth.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { sealSecret, openSecret } from "./secretbox.js";

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

interface UserAuthRow {
  user_id: string;
  role: AccessClaims["role"];
  congregation_id: string | null;
}

export class IdentityService {
  constructor(
    private readonly pool: Pool,
    private readonly env: Env,
  ) {}

  private async issueSession(user: UserAuthRow, deviceId?: string | null): Promise<SessionTokens> {
    const access = signAccessToken(this.env, {
      sub: user.user_id,
      role: user.role,
      cong: user.congregation_id ?? "",
    });
    const refresh = await issueRefreshToken(
      this.pool,
      user.user_id,
      this.env,
      deviceId == null ? {} : { deviceId },
    );
    return {
      access_token: access,
      refresh_token: refresh.token,
      token_type: "Bearer",
      expires_in: this.env.JWT_ACCESS_TTL,
    };
  }

  /** Find-or-create a user from a verified IdP profile, then mint a session. */
  async loginWithOAuth(profile: OAuthProfile): Promise<SessionTokens> {
    const user = await tx(this.pool, async (c) => {
      const existing = await maybeOne<UserAuthRow>(
        c,
        `SELECT u.user_id, u.role, u.congregation_id
           FROM oauth_identities oi JOIN users u ON u.user_id = oi.user_id
          WHERE oi.provider = $1 AND oi.provider_sub = $2 AND u.deleted_at IS NULL`,
        [profile.provider, profile.sub],
      );
      if (existing) return existing;

      // First login: provision a minimal user (intake completes at onboarding).
      const created = await one<UserAuthRow>(
        c,
        `INSERT INTO users (full_name, email, role)
         VALUES ($1, $2, 'Student')
         RETURNING user_id, role, congregation_id`,
        [profile.fullName ?? "New Member", profile.email ?? null],
      );
      await c.query(
        `INSERT INTO oauth_identities (user_id, provider, provider_sub) VALUES ($1,$2,$3)`,
        [created.user_id, profile.provider, profile.sub],
      );
      await audit(c, created.user_id, "user.provisioned", "users", created.user_id, {
        provider: profile.provider,
      });
      return created;
    });
    return this.issueSession(user);
  }

  async refresh(rawToken: string): Promise<SessionTokens> {
    const { userId, refresh } = await rotateRefreshToken(this.pool, rawToken, this.env);
    const user = await one<UserAuthRow>(
      this.pool,
      `SELECT user_id, role, congregation_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const access = signAccessToken(this.env, {
      sub: user.user_id,
      role: user.role,
      cong: user.congregation_id ?? "",
    });
    return {
      access_token: access,
      refresh_token: refresh.token,
      token_type: "Bearer",
      expires_in: this.env.JWT_ACCESS_TTL,
    };
  }

  async logout(rawToken: string): Promise<void> {
    await revokeFamily(this.pool, rawToken);
  }

  /**
   * DEV ONLY. Mint a real session for an already-seeded user, bypassing OAuth so
   * the portal can authenticate locally. Uses the SAME token path as production
   * (issueSession → signAccessToken + issueRefreshToken) — no parallel logic. The
   * route is hard-gated to NODE_ENV !== 'production' and never mounted there.
   */
  static readonly LoginSchema = z
    .object({ email: z.string().email(), password: z.string().min(1).max(200) })
    .strict();

  /**
   * Email + password sign-in (argon2id verify, §5.5). Errors are intentionally
   * generic to avoid user enumeration; suspended accounts are blocked. SSO-only
   * accounts (no stored secret) cannot password-login. Mints a normal session.
   */
  async loginWithPassword(input: z.infer<typeof IdentityService.LoginSchema>): Promise<SessionTokens> {
    const row = await maybeOne<UserAuthRow & { password_hash: string | null; account_status: string }>(
      this.pool,
      `SELECT user_id, role, congregation_id, password_hash, account_status
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [input.email],
    );
    if (!row || !row.password_hash) throw new ApiError("AUTH_REQUIRED", "Invalid email or password");
    if (row.account_status === "suspended") throw new ApiError("FORBIDDEN_SCOPE", "This account is suspended");
    if (!(await verifyPassword(row.password_hash, input.password))) {
      throw new ApiError("AUTH_REQUIRED", "Invalid email or password");
    }
    return this.issueSession({ user_id: row.user_id, role: row.role, congregation_id: row.congregation_id });
  }

  static readonly RegisterSchema = z
    .object({
      full_name: z.string().trim().min(1).max(255),
      email: z.string().email().max(254),
      password: z.string().min(6).max(200),
    })
    .strict();

  /**
   * Self-service sign-up (Figma "Create account"). Provisions a Student with a
   * stored argon2id secret and mints a normal session (auto sign-in). Onboarding
   * (cell, DOB, enrollment at L1·M1) is completed later via /me/onboarding. Email
   * is CITEXT UNIQUE — a duplicate is rejected with 409 (constraint also enforces
   * it under a race). Self-signup can only ever create a Student (§5.4, §5.8).
   */
  async register(input: z.infer<typeof IdentityService.RegisterSchema>): Promise<SessionTokens> {
    const hash = await hashPassword(input.password);
    const user = await tx(this.pool, async (c) => {
      const existing = await maybeOne<{ user_id: string }>(
        c,
        `SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [input.email],
      );
      if (existing) throw new ApiError("CONFLICT", "An account with this email already exists");
      let created: UserAuthRow;
      try {
        created = await one<UserAuthRow>(
          c,
          `INSERT INTO users (full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'Student')
           RETURNING user_id, role, congregation_id`,
          [input.full_name, input.email, hash],
        );
      } catch (e) {
        // Unique-violation under a concurrent insert collapses to the same 409.
        if ((e as { code?: string }).code === "23505") {
          throw new ApiError("CONFLICT", "An account with this email already exists");
        }
        throw e;
      }
      await c.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [created.user_id],
      );
      await audit(c, created.user_id, "user.registered", "users", created.user_id, { self_signup: true });
      return created;
    });
    return this.issueSession(user);
  }

  static readonly ForgotPasswordSchema = z.object({ email: z.string().email().max(254) }).strict();

  /**
   * Request a password-reset link (Figma "Reset password"). Always reports success
   * to avoid account enumeration; only accounts that actually have a password get a
   * token. We persist the SHA-256 of a single-use 30-minute token (never the raw
   * value). With no email provider wired, non-production returns the raw token so
   * the flow is testable end-to-end; production would deliver it by email instead.
   */
  async requestPasswordReset(
    input: z.infer<typeof IdentityService.ForgotPasswordSchema>,
  ): Promise<{ sent: true; dev_token?: string }> {
    const row = await maybeOne<{ user_id: string; password_hash: string | null }>(
      this.pool,
      `SELECT user_id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [input.email],
    );
    if (!row || !row.password_hash) return { sent: true };
    const raw = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [row.user_id, tokenHash, expires],
    );
    await audit(this.pool, row.user_id, "user.password_reset_requested", "users", row.user_id, {});
    return this.env.NODE_ENV === "production" ? { sent: true } : { sent: true, dev_token: raw };
  }

  static readonly ResetPasswordSchema = z
    .object({ token: z.string().min(16).max(200), new_password: z.string().min(6).max(200) })
    .strict();

  /**
   * Consume a reset token and set a new password. The token must be unused and
   * unexpired; it is burned on use. All refresh-token families are revoked so any
   * session opened with the old (possibly compromised) credential dies.
   */
  async resetPassword(
    input: z.infer<typeof IdentityService.ResetPasswordSchema>,
  ): Promise<{ reset: true }> {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const newHash = await hashPassword(input.new_password);
    await tx(this.pool, async (c) => {
      const reset = await maybeOne<{ reset_id: string; user_id: string }>(
        c,
        `SELECT reset_id, user_id FROM password_resets
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [tokenHash],
      );
      if (!reset) throw new ApiError("UNPROCESSABLE", "This reset link is invalid or has expired");
      await c.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1`, [
        reset.user_id,
        newHash,
      ]);
      await c.query(`UPDATE password_resets SET used_at = now() WHERE reset_id = $1`, [reset.reset_id]);
      await c.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [reset.user_id],
      );
      await audit(c, reset.user_id, "user.password_reset", "users", reset.user_id, {});
    });
    return { reset: true };
  }

  async devLogin(input: { email?: string | undefined; user_id?: string | undefined }): Promise<SessionTokens> {
    const byId = Boolean(input.user_id);
    const key = input.user_id ?? input.email;
    if (!key) throw new ApiError("VALIDATION_FAILED", "email or user_id is required");
    const user = await maybeOne<UserAuthRow>(
      this.pool,
      `SELECT user_id, role, congregation_id FROM users
        WHERE ${byId ? "user_id = $1" : "email = $1"} AND deleted_at IS NULL`,
      [key],
    );
    if (!user) throw new ApiError("NOT_FOUND", "No such user");
    return this.issueSession(user);
  }

  /**
   * Begin TOTP enrollment (§5.3): generate a secret, seal it at rest, and return
   * the otpauth:// URI for the authenticator app. The factor is not yet enabled —
   * it activates only when the first code is verified (verifyMfa), so a dropped
   * enrollment can never lock the user out of step-up.
   */
  async enrollMfa(userId: string): Promise<{ otpauth_uri: string; secret: string }> {
    const user = await one<{ email: string | null }>(
      this.pool,
      `SELECT email FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const secret = generateTotpSecret();
    await this.pool.query(
      `UPDATE users SET mfa_secret = $1, mfa_enabled = FALSE, mfa_enrolled_at = NULL WHERE user_id = $2`,
      [sealSecret(secret, this.env.JWT_SIGNING_KEY), userId],
    );
    await audit(this.pool, userId, "mfa.enroll_started", "users", userId, {});
    return { otpauth_uri: otpauthUri(secret, user.email ?? userId), secret };
  }

  /**
   * Verify a TOTP code and return an MFA-elevated access token (carries the
   * mfa/mfa_at claim the requireStepUp guard checks). Confirms enrollment on the
   * first valid code. The refresh token is unchanged — this elevates the session,
   * it does not replace it; elevation expires with the short access token.
   */
  async verifyMfa(
    userId: string,
    code: string,
  ): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; mfa_enabled: boolean }> {
    const row = await one<{
      role: AccessClaims["role"];
      congregation_id: string | null;
      mfa_secret: string | null;
      mfa_enabled: boolean;
    }>(
      this.pool,
      `SELECT role, congregation_id, mfa_secret, mfa_enabled
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row.mfa_secret) throw new ApiError("VALIDATION_FAILED", "MFA is not enrolled");
    const secret = openSecret(row.mfa_secret, this.env.JWT_SIGNING_KEY);
    if (!verifyTotp(secret, code)) throw new ApiError("AUTH_REQUIRED", "Invalid MFA code");

    if (!row.mfa_enabled) {
      await this.pool.query(
        `UPDATE users SET mfa_enabled = TRUE, mfa_enrolled_at = now() WHERE user_id = $1`,
        [userId],
      );
      await audit(this.pool, userId, "mfa.enabled", "users", userId, {});
    }

    const access = signAccessToken(this.env, {
      sub: userId,
      role: row.role,
      cong: row.congregation_id ?? "",
      mfa: true,
      mfa_at: Math.floor(Date.now() / 1000),
    });
    return { access_token: access, token_type: "Bearer", expires_in: this.env.JWT_ACCESS_TTL, mfa_enabled: true };
  }

  async getMe(userId: string): Promise<unknown> {
    const profile = await one(
      this.pool,
      `SELECT u.user_id, u.email, u.full_name, u.phone_number, u.date_of_birth, u.year_of_salvation,
              u.is_baptized, u.cell_group_id, u.congregation_id, u.role, u.timezone, u.locale, u.is_minor,
              u.gender, u.city, u.country_code, u.socials, u.row_version, u.created_at, u.account_status, u.require_2fa,
              COALESCE(array_agg(ur.role_key) FILTER (WHERE ur.role_key IS NOT NULL), '{}') AS role_keys
         FROM users u
         LEFT JOIN rbac_user_roles ur ON ur.user_id = u.user_id
        WHERE u.user_id = $1 AND u.deleted_at IS NULL
        GROUP BY u.user_id`,
      [userId],
    );
    const enrollment = await maybeOne(
      this.pool,
      `SELECT enrollment_id, current_level, state, started_at FROM enrollments WHERE user_id = $1`,
      [userId],
    );
    return { profile, enrollment };
  }

  /** The caller's own recent portal actions (Profile ▸ My Activity), from the audit log. */
  async myActivity(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT audit_id, action, entity, entity_id, occurred_at
         FROM audit_log WHERE actor_id = $1
        ORDER BY audit_id DESC LIMIT 20`,
      [userId],
    );
  }

  static readonly UpdateMeSchema = z
    .object({
      full_name: z.string().min(1).max(255).optional(),
      phone_number: z.string().min(3).max(32).optional(),
      cell_group_id: z.string().uuid().nullable().optional(),
      timezone: z.string().max(64).optional(),
      locale: z.string().max(12).optional(),
      gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
      city: z.string().max(120).nullable().optional(),
      country_code: z.string().length(2).nullable().optional(),
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      socials: z.record(z.string().max(200)).optional(), // {instagram, x, facebook, ...}
      row_version: z.number().int().positive(),
    })
    .strict(); // mass-assignment guard (§5.8): role/congregation_id are not writable
    // email is intentionally not writable here — it is the login identity (§5.8).

  /** Update mutable profile fields with an optimistic-concurrency version check. */
  async updateMe(userId: string, input: z.infer<typeof IdentityService.UpdateMeSchema>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const field of ["full_name", "phone_number", "cell_group_id", "timezone", "locale", "gender", "city", "country_code", "date_of_birth", "socials"] as const) {
        if (field in input && input[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          params.push(field === "socials" ? JSON.stringify(input[field]) : input[field]);
        }
      }
      sets.push(`row_version = row_version + 1`, `updated_at = now()`);
      params.push(userId, input.row_version);
      const updated = await maybeOne<{ user_id: string; row_version: number }>(
        c,
        `UPDATE users SET ${sets.join(", ")}
           WHERE user_id = $${i++} AND row_version = $${i} AND deleted_at IS NULL
         RETURNING user_id, row_version`,
        params,
      );
      if (!updated) {
        const current = await maybeOne<{ row_version: number }>(
          c,
          `SELECT row_version FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
          [userId],
        );
        if (!current) throw new ApiError("NOT_FOUND", "User not found");
        throw new ApiError("VERSION_STALE", "Profile was modified; re-merge and retry", {
          current_row_version: current.row_version,
        });
      }
      await recordChange(c, "users", userId, userId, "upsert");
      return updated;
    });
  }

  static readonly ChangePasswordSchema = z
    .object({
      current_password: z.string().min(1).max(200),
      new_password: z.string().min(8).max(200),
    })
    .strict();

  /**
   * Change the account password (B6 Profile). Requires the current password
   * (argon2id verify, §5.5); SSO-only accounts have no stored secret and are
   * directed to their provider instead. All refresh-token families are revoked
   * so stolen sessions die with the old credential.
   */
  async changePassword(
    userId: string,
    input: z.infer<typeof IdentityService.ChangePasswordSchema>,
  ): Promise<{ changed: boolean }> {
    const row = await maybeOne<{ password_hash: string | null }>(
      this.pool,
      `SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "User not found");
    if (!row.password_hash) {
      throw new ApiError("UNPROCESSABLE", "This account signs in with a provider and has no password");
    }
    if (!(await verifyPassword(row.password_hash, input.current_password))) {
      throw new ApiError("FORBIDDEN_SCOPE", "Current password is incorrect");
    }
    const newHash = await hashPassword(input.new_password);
    await this.pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1`, [
      userId,
      newHash,
    ]);
    // Old sessions die with the old credential: revoke every refresh chain.
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await audit(this.pool, userId, "user.password_changed", "users", userId, {});
    return { changed: true };
  }

  static readonly OnboardingSchema = z
    .object({
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      phone_number: z.string().min(3).max(32),
      cell_group_id: z.string().uuid(),
      year_of_salvation: z.number().int().min(1900).max(2100).optional(),
      is_baptized: z.boolean().default(false),
      timezone: z.string().max(64).optional(),
    })
    .strict();

  /**
   * Baseline intake (§3.3). Sets the required profile fields, derives the
   * congregation from the chosen cell, and instantiates the enrollment at L1·M1.
   * Idempotent: a member who already has an enrollment is returned as-is.
   */
  async onboard(userId: string, input: z.infer<typeof IdentityService.OnboardingSchema>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cell = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM cell_groups WHERE cell_group_id = $1`,
        [input.cell_group_id],
      );
      if (!cell) throw new ApiError("VALIDATION_FAILED", "Unknown cell_group_id");

      await c.query(
        `UPDATE users SET date_of_birth = $1, phone_number = $2, cell_group_id = $3,
                          congregation_id = $4, year_of_salvation = $5, is_baptized = $6,
                          timezone = COALESCE($7, timezone), row_version = row_version + 1
           WHERE user_id = $8 AND deleted_at IS NULL`,
        [
          input.date_of_birth,
          input.phone_number,
          input.cell_group_id,
          cell.congregation_id,
          input.year_of_salvation ?? null,
          input.is_baptized,
          input.timezone ?? null,
          userId,
        ],
      );

      const existing = await maybeOne<{ enrollment_id: string }>(
        c,
        `SELECT enrollment_id FROM enrollments WHERE user_id = $1`,
        [userId],
      );
      if (existing) return { enrollment_id: existing.enrollment_id, already_onboarded: true };

      const enrollment = await one<{ enrollment_id: string }>(
        c,
        `INSERT INTO enrollments (user_id, current_level, state) VALUES ($1, 1, 'active')
         RETURNING enrollment_id`,
        [userId],
      );
      // Notification prefs default row so the nudge cadence has somewhere to read.
      await c.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId],
      );
      await recordChange(c, "enrollments", enrollment.enrollment_id, userId, "upsert");
      await audit(c, userId, "user.onboarded", "enrollments", enrollment.enrollment_id, {});
      return { enrollment_id: enrollment.enrollment_id, current_level: 1, already_onboarded: false };
    });
  }

  async registerDevice(
    userId: string,
    input: { platform: string; app_version?: string | undefined; push_token?: string | undefined },
  ): Promise<{ device_id: string }> {
    return tx(this.pool, async (c) => {
      const device = await one<{ device_id: string }>(
        c,
        `INSERT INTO client_devices (user_id, platform, app_version) VALUES ($1,$2,$3)
         RETURNING device_id`,
        [userId, input.platform, input.app_version ?? null],
      );
      if (input.push_token) {
        await c.query(
          `INSERT INTO push_tokens (user_id, platform, token) VALUES ($1,$2,$3)
           ON CONFLICT (token) DO UPDATE SET is_active = TRUE, updated_at = now()`,
          [userId, input.platform, input.push_token],
        );
      }
      return device;
    });
  }
}
