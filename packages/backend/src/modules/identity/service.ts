// Identity service (spec §1.5, §3.3, §5.3). Provisioning from OAuth, profile
// read/update with optimistic concurrency, and the onboarding intake that
// instantiates the enrollment at Level 1 · Module 1.
import type { Pool } from "pg";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../http/errors.js";
import { maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  type AccessClaims,
} from "./tokens.js";
import type { OAuthProfile } from "./oauth.js";

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
    const refresh = await issueRefreshToken(this.pool, user.user_id, this.env, { deviceId });
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

  async getMe(userId: string): Promise<unknown> {
    const profile = await one(
      this.pool,
      `SELECT user_id, email, full_name, phone_number, date_of_birth, year_of_salvation,
              is_baptized, cell_group_id, congregation_id, role, timezone, locale, is_minor, row_version
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const enrollment = await maybeOne(
      this.pool,
      `SELECT enrollment_id, current_level, state, started_at FROM enrollments WHERE user_id = $1`,
      [userId],
    );
    return { profile, enrollment };
  }

  static readonly UpdateMeSchema = z
    .object({
      phone_number: z.string().min(3).max(32).optional(),
      cell_group_id: z.string().uuid().nullable().optional(),
      timezone: z.string().max(64).optional(),
      locale: z.string().max(12).optional(),
      row_version: z.number().int().positive(),
    })
    .strict(); // mass-assignment guard (§5.8): role/congregation_id are not writable

  /** Update mutable profile fields with an optimistic-concurrency version check. */
  async updateMe(userId: string, input: z.infer<typeof IdentityService.UpdateMeSchema>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const field of ["phone_number", "cell_group_id", "timezone", "locale"] as const) {
        if (field in input && input[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          params.push(input[field]);
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
    input: { platform: string; app_version?: string; push_token?: string },
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
