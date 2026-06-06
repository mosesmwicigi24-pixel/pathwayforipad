// Onboarding service (Features v2 §O). A resumable, server-held stepper so a
// dropped connection never loses progress; guardian consent is ENFORCED for
// minors before finalize (§5.9); the literacy quiz is server-scored. Finalize
// reuses the existing identity.onboard() (enrollment at L1·M1) — no duplicate logic.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { IdentityService } from "../identity/service.js";
import { sealSecret } from "../identity/secretbox.js";
import type { Env } from "../../config/env.js";

type Step = "profile" | "cell_selection" | "guardian_consent" | "literacy_quiz" | "notifications" | "done";

// A tiny fixed literacy check (server-scored). Real copy comes from the PRD.
const LITERACY_ITEMS = [
  { id: "q1", prompt: "Tap the GO button to continue.", options: ["GO", "STOP"], answer: "GO" },
  { id: "q2", prompt: "Which is a number?", options: ["7", "seven letters"], answer: "7" },
  { id: "q3", prompt: "Select the green circle.", options: ["green", "red"], answer: "green" },
];

function requiredSteps(isMinor: boolean): Step[] {
  return ["profile", "cell_selection", ...(isMinor ? (["guardian_consent"] as Step[]) : []), "literacy_quiz", "notifications"];
}

export class OnboardingService {
  private readonly identity: IdentityService;
  constructor(
    private readonly pool: Pool,
    private readonly env: Env,
  ) {
    this.identity = new IdentityService(pool, env);
  }

  private async isMinor(c: Queryable, userId: string): Promise<boolean> {
    const u = await maybeOne<{ is_minor: boolean }>(c, `SELECT is_minor FROM users WHERE user_id = $1`, [userId]);
    return Boolean(u?.is_minor);
  }

  private async ensureSession(c: Queryable, userId: string): Promise<{ current_step: Step; steps: Record<string, unknown> }> {
    await c.query(`INSERT INTO onboarding_sessions (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    return one<{ current_step: Step; steps: Record<string, unknown> }>(
      c,
      `SELECT current_step, steps FROM onboarding_sessions WHERE user_id = $1`,
      [userId],
    );
  }

  private async markStep(c: Queryable, userId: string, step: Step): Promise<Step> {
    const session = await this.ensureSession(c, userId);
    const steps = { ...session.steps, [step]: { completed_at: new Date().toISOString() } };
    const minor = await this.isMinor(c, userId);
    const next = requiredSteps(minor).find((s) => !(s in steps)) ?? "done";
    await c.query(
      `UPDATE onboarding_sessions SET current_step = $2::onboarding_step, steps = $3,
              completed_at = CASE WHEN $2::onboarding_step = 'done' THEN now() ELSE completed_at END
         WHERE user_id = $1`,
      [userId, next, JSON.stringify(steps)],
    );
    return next;
  }

  async getSession(userId: string): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const session = await this.ensureSession(c, userId);
      const minor = await this.isMinor(c, userId);
      const required = requiredSteps(minor);
      return {
        current_step: session.current_step,
        completed: Object.keys(session.steps),
        required,
        is_minor: minor,
        next_required: required.find((s) => !(s in session.steps)) ?? "done",
      };
    });
  }

  // ---------------- Steps ----------------

  static readonly Profile = z
    .object({
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      phone_number: z.string().min(3).max(32),
      year_of_salvation: z.number().int().min(1900).max(2100).optional(),
      is_baptized: z.boolean().default(false),
    })
    .strict();

  async putProfile(userId: string, input: z.infer<typeof OnboardingService.Profile>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      await c.query(
        `UPDATE users SET date_of_birth = $1, phone_number = $2, year_of_salvation = $3, is_baptized = $4,
                          row_version = row_version + 1, updated_at = now()
           WHERE user_id = $5 AND deleted_at IS NULL`,
        [input.date_of_birth, input.phone_number, input.year_of_salvation ?? null, input.is_baptized, userId],
      );
      await recordChange(c, "users", userId, userId, "upsert");
      const next = await this.markStep(c, userId, "profile");
      return { ok: true, current_step: next };
    });
  }

  static readonly CellSelection = z.object({ cell_group_id: z.string().uuid() }).strict();

  async putCellSelection(userId: string, input: z.infer<typeof OnboardingService.CellSelection>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cell = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM cell_groups WHERE cell_group_id = $1`, [input.cell_group_id]);
      if (!cell) throw new ApiError("VALIDATION_FAILED", "Unknown cell_group_id");
      await c.query(
        `UPDATE users SET cell_group_id = $1, congregation_id = $2, row_version = row_version + 1, updated_at = now()
           WHERE user_id = $3 AND deleted_at IS NULL`,
        [input.cell_group_id, cell.congregation_id, userId],
      );
      const next = await this.markStep(c, userId, "cell_selection");
      return { ok: true, current_step: next };
    });
  }

  static readonly GuardianConsent = z
    .object({
      guardian_name: z.string().min(1).max(255),
      guardian_contact: z.string().min(3).max(255),
      relationship: z.string().min(1).max(60),
      consent_text_version: z.string().min(1).max(20),
    })
    .strict();

  async putGuardianConsent(userId: string, recordedBy: string, input: z.infer<typeof OnboardingService.GuardianConsent>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      if (!(await this.isMinor(c, userId))) {
        throw new ApiError("UNPROCESSABLE", "Guardian consent only applies to minors");
      }
      const existing = await maybeOne(c, `SELECT 1 FROM guardian_consents WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      if (existing) throw new ApiError("CONFLICT", "Consent already on file; revoke before recording a new one");
      await c.query(
        `INSERT INTO guardian_consents (user_id, guardian_name, guardian_contact, relationship, consent_text_version, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, input.guardian_name, sealSecret(input.guardian_contact, this.env.JWT_SIGNING_KEY), input.relationship, input.consent_text_version, recordedBy],
      );
      await audit(c, recordedBy, "onboarding.consent_recorded", "users", userId, { version: input.consent_text_version });
      const next = await this.markStep(c, userId, "guardian_consent");
      return { ok: true, current_step: next };
    });
  }

  getLiteracyQuiz(): unknown {
    return { items: LITERACY_ITEMS.map((i) => ({ id: i.id, prompt: i.prompt, options: i.options })) };
  }

  static readonly LiteracyAnswers = z.object({
    answers: z.array(z.object({ id: z.string(), answer: z.string() })).min(1),
    client_mutation_id: z.string().uuid().optional(),
  });

  async putLiteracyQuiz(userId: string, input: z.infer<typeof OnboardingService.LiteracyAnswers>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ score: string }>(c, `SELECT score FROM onboarding_assessments WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { duplicate: true, score: Number(dup.score) };
      }
      const given = new Map(input.answers.map((a) => [a.id, a.answer]));
      let correct = 0;
      const detail = LITERACY_ITEMS.map((i) => {
        const ok = given.get(i.id) === i.answer;
        if (ok) correct += 1;
        return { id: i.id, correct: ok };
      });
      const score = Math.round((correct / LITERACY_ITEMS.length) * 10000) / 100;
      await c.query(
        `INSERT INTO onboarding_assessments (user_id, kind, score, result, client_mutation_id)
         VALUES ($1,'literacy',$2,$3,$4)`,
        [userId, score, JSON.stringify({ detail }), input.client_mutation_id ?? null],
      );
      const next = await this.markStep(c, userId, "literacy_quiz");
      return { duplicate: false, score, current_step: next };
    });
  }

  static readonly Notifications = z
    .object({
      push_enabled: z.boolean().optional(),
      email_enabled: z.boolean().optional(),
      quiet_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      quiet_to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      max_daily: z.number().int().min(0).max(20).optional(),
    })
    .strict();

  async putNotifications(userId: string, input: z.infer<typeof OnboardingService.Notifications>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      await c.query(
        `INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, quiet_from, quiet_to, max_daily)
         VALUES ($1, COALESCE($2::boolean,TRUE), COALESCE($3::boolean,TRUE),
                 COALESCE($4::time,'21:00'::time), COALESCE($5::time,'07:00'::time), COALESCE($6::int,3))
         ON CONFLICT (user_id) DO UPDATE SET
           push_enabled = COALESCE($2::boolean, notification_preferences.push_enabled),
           email_enabled = COALESCE($3::boolean, notification_preferences.email_enabled),
           quiet_from = COALESCE($4::time, notification_preferences.quiet_from),
           quiet_to = COALESCE($5::time, notification_preferences.quiet_to),
           max_daily = COALESCE($6::int, notification_preferences.max_daily)`,
        [userId, input.push_enabled ?? null, input.email_enabled ?? null, input.quiet_from ?? null, input.quiet_to ?? null, input.max_daily ?? null],
      );
      const next = await this.markStep(c, userId, "notifications");
      return { ok: true, current_step: next };
    });
  }

  // ---------------- Finalize ----------------

  async finalize(userId: string): Promise<unknown> {
    const profile = await one<{
      date_of_birth: string | null;
      phone_number: string | null;
      cell_group_id: string | null;
      is_minor: boolean;
      year_of_salvation: number | null;
      is_baptized: boolean;
      timezone: string | null;
    }>(
      this.pool,
      `SELECT to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth, phone_number, cell_group_id, is_minor,
              year_of_salvation, is_baptized, timezone
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!profile.date_of_birth || !profile.phone_number) throw new ApiError("UNPROCESSABLE", "Complete the profile step first");
    if (!profile.cell_group_id) throw new ApiError("UNPROCESSABLE", "Complete the cell selection step first");

    if (profile.is_minor) {
      const consent = await maybeOne(this.pool, `SELECT 1 FROM guardian_consents WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      if (!consent) throw new ApiError("UNPROCESSABLE", "Guardian consent is required for minors", { code: "CONSENT_REQUIRED" });
    }

    const result = await this.identity.onboard(userId, {
      date_of_birth: profile.date_of_birth,
      phone_number: profile.phone_number,
      cell_group_id: profile.cell_group_id,
      is_baptized: profile.is_baptized,
      ...(profile.year_of_salvation !== null ? { year_of_salvation: profile.year_of_salvation } : {}),
      ...(profile.timezone !== null ? { timezone: profile.timezone } : {}),
    });
    await tx(this.pool, (c) => this.markStep(c, userId, "done").then(() => undefined));
    return result;
  }

  // ---------------- Directory ----------------

  directory(congregationId: string, search?: string): Promise<unknown[]> {
    const params: unknown[] = [congregationId];
    let where = `congregation_id = $1`;
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND name ILIKE $${params.length}`;
    }
    return many<unknown>(this.pool, `SELECT cell_group_id, name, meeting_cadence FROM cell_groups WHERE ${where} ORDER BY name LIMIT 50`, params);
  }
}
