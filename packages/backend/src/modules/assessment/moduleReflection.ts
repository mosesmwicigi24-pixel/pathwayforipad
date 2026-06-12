// Module-reflection review (Design Contract Matrix B3). The portal's Reflection
// Queue over PER-MODULE reflections: approve / return (sends it back to the
// member and re-locks gating until resubmitted) / defer (parks it without
// blocking). Reviewers are cell-scoped like every pastoral surface (§5.4); the
// internal pastoral note is never exposed to the member; every decision is
// audited and the member (and optionally their multiplier) is notified.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { NotificationService } from "../notifications/service.js";

const DECISION_TO_STATE = { approve: "approved", return: "returned", defer: "deferred" } as const;

export class ModuleReflectionService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  /** The member's own reflection for a module — state + feedback, never the pastoral note. */
  async myReflection(userId: string, moduleId: string): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `SELECT reflection_id, module_id, body, state::text, feedback_notes, submitted_at, reviewed_at
         FROM module_reflections WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No reflection submitted for this module");
    return row;
  }

  static readonly Queue = z.object({
    state: z.enum(["pending", "approved", "rejected", "returned", "deferred"]).default("pending"),
    overdue: z.coerce.boolean().optional(), // pending > 3 days
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  /** The reviewer's queue, scoped: Instructors see only their assigned cells. */
  async queue(principal: Principal, q: z.infer<typeof ModuleReflectionService.Queue>): Promise<unknown[]> {
    const params: unknown[] = [q.state];
    const where: string[] = [`mr.state = $1::review_state`];
    if (q.overdue) where.push(`mr.submitted_at < now() - interval '3 days'`);
    if (principal.role !== "Admin" && principal.role !== "SuperAdmin") {
      params.push(principal.userId);
      where.push(
        `u.cell_group_id IN (SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $${params.length})`,
      );
    }
    params.push(q.limit);
    return many(
      this.pool,
      `SELECT mr.reflection_id, mr.user_id, u.full_name, u.cell_group_id, mr.module_id, m.title AS module_title,
              m.level_number, mr.body, mr.state::text, mr.submitted_at, mr.reviewed_at,
              (mr.state = 'pending' AND mr.submitted_at < now() - interval '3 days') AS overdue
         FROM module_reflections mr
         JOIN users u ON u.user_id = mr.user_id
         JOIN modules m ON m.module_id = mr.module_id
        WHERE ${where.join(" AND ")}
        ORDER BY mr.submitted_at ASC
        LIMIT $${params.length}`,
      params,
    );
  }

  static readonly Decision = z
    .object({
      decision: z.enum(["approve", "return", "defer"]),
      feedback_notes: z.string().max(2000).optional(), // shown to the member
      pastoral_note: z.string().max(2000).optional(), // internal only
      notify_multiplier: z.boolean().default(false),
    })
    .strict()
    .refine((d) => d.decision !== "return" || (d.feedback_notes ?? "").trim().length > 0, {
      message: "Returning a reflection requires feedback for the member",
    });

  /** Approve / return / defer — scope-checked, audited, member (+multiplier) notified. */
  async decide(
    principal: Principal,
    reflectionId: string,
    input: z.infer<typeof ModuleReflectionService.Decision>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const refl = await maybeOne<{ user_id: string; module_id: string; cell_group_id: string | null; state: string }>(
        c,
        `SELECT mr.user_id, mr.module_id, u.cell_group_id, mr.state::text
           FROM module_reflections mr JOIN users u ON u.user_id = mr.user_id
          WHERE mr.reflection_id = $1 FOR UPDATE OF mr`,
        [reflectionId],
      );
      if (!refl) throw new ApiError("NOT_FOUND", "Reflection not found");
      await assertCellInScope(c, principal, refl.cell_group_id ?? "");

      const state = DECISION_TO_STATE[input.decision];
      const row = await one(
        c,
        `UPDATE module_reflections
            SET state = $2::review_state, reviewed_by = $3, reviewed_at = now(),
                feedback_notes = $4, pastoral_note = COALESCE($5, pastoral_note)
          WHERE reflection_id = $1
          RETURNING reflection_id, user_id, module_id, state, feedback_notes, reviewed_at`,
        [reflectionId, state, principal.userId, input.feedback_notes ?? null, input.pastoral_note ?? null],
      );
      await recordChange(c, "module_reflections", reflectionId, refl.user_id, "upsert");
      await audit(c, principal.userId, `reflection.${input.decision}`, "module_reflections", reflectionId, {
        user_id: refl.user_id,
        module_id: refl.module_id,
        // The pastoral note's CONTENT stays out of the audit metadata too —
        // only the fact one was recorded.
        pastoral_note_recorded: input.pastoral_note != null,
      });

      // Notify the member (and, when asked, their multiplier). Best-effort.
      const targets = [refl.user_id];
      if (input.notify_multiplier) {
        const rel = await maybeOne<{ multiplier_id: string }>(
          c,
          `SELECT multiplier_id FROM relationship_tree WHERE disciple_id = $1`,
          [refl.user_id],
        );
        if (rel) targets.push(rel.multiplier_id);
      }
      for (const userId of targets) {
        try {
          await this.notifications.schedule({
            userId,
            channel: "push",
            template: `reflection_${state}`,
            payload: { module_id: refl.module_id, feedback: input.feedback_notes ?? null },
          });
        } catch {
          // best-effort
        }
      }
      return row;
    });
  }

  /** Review history for one reflection — the audited decision trail. */
  async history(principal: Principal, reflectionId: string): Promise<unknown[]> {
    const refl = await maybeOne<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT u.cell_group_id FROM module_reflections mr JOIN users u ON u.user_id = mr.user_id
        WHERE mr.reflection_id = $1`,
      [reflectionId],
    );
    if (!refl) throw new ApiError("NOT_FOUND", "Reflection not found");
    await assertCellInScope(this.pool, principal, refl.cell_group_id ?? "");
    return many(
      this.pool,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.occurred_at
         FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE a.entity = 'module_reflections' AND a.entity_id = $1
        ORDER BY a.audit_id DESC`,
      [reflectionId],
    );
  }
}
