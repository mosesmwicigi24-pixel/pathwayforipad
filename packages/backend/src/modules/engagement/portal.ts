// Portal write actions (spec §3.3, §5.4): the multiplier→disciple relationship
// tree and external milestone updates (water baptism verified, etc.). Both are
// scope-checked against the actor's leader_assignments; Admin/SuperAdmin pass.
import type { Pool } from "pg";
import { z } from "zod";
import { one, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export class PortalService {
  constructor(private readonly pool: Pool) {}

  static readonly RelationshipSchema = z.object({
    disciple_id: z.string().uuid(),
    multiplier_id: z.string().uuid().optional(),
  });

  /** Log a multiplier→disciple edge (§3.3). Instructors disciple within their cells. */
  async addRelationship(
    principal: Principal,
    input: z.infer<typeof PortalService.RelationshipSchema>,
  ): Promise<{ tree_id: string }> {
    const isAdmin = principal.role === "Admin" || principal.role === "SuperAdmin";
    const multiplierId = isAdmin && input.multiplier_id ? input.multiplier_id : principal.userId;
    if (multiplierId === input.disciple_id) {
      throw new ApiError("VALIDATION_FAILED", "A member cannot disciple themselves");
    }

    const disciple = await one<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [input.disciple_id],
    );
    await assertCellInScope(this.pool, principal, disciple.cell_group_id ?? "");

    try {
      const row = await one<{ tree_id: string }>(
        this.pool,
        `INSERT INTO relationship_tree (multiplier_id, disciple_id) VALUES ($1, $2) RETURNING tree_id`,
        [multiplierId, input.disciple_id],
      );
      await audit(this.pool, principal.userId, "relationship.linked", "relationship_tree", row.tree_id, {
        multiplier_id: multiplierId,
        disciple_id: input.disciple_id,
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError("CONFLICT", "This disciple already has a multiplier");
      throw err;
    }
  }

  static readonly MilestoneSchema = z
    .object({
      is_baptized: z.boolean().optional(),
      year_of_salvation: z.number().int().min(1900).max(2100).nullable().optional(),
    })
    .strict();

  /** Record verified external milestones on a member (§3.3). Scope-checked. */
  async setMilestones(
    principal: Principal,
    memberId: string,
    input: z.infer<typeof PortalService.MilestoneSchema>,
  ): Promise<Record<string, unknown>> {
    const member = await one<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [memberId],
    );
    await assertCellInScope(this.pool, principal, member.cell_group_id ?? "");

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (input.is_baptized !== undefined) {
      sets.push(`is_baptized = $${i++}`);
      params.push(input.is_baptized);
    }
    if (input.year_of_salvation !== undefined) {
      sets.push(`year_of_salvation = $${i++}`);
      params.push(input.year_of_salvation);
    }
    if (sets.length === 0) throw new ApiError("VALIDATION_FAILED", "No milestone fields provided");
    sets.push(`updated_at = now()`, `row_version = row_version + 1`);
    params.push(memberId);

    const updated = await one<Record<string, unknown>>(
      this.pool,
      `UPDATE users SET ${sets.join(", ")} WHERE user_id = $${i} AND deleted_at IS NULL
       RETURNING user_id, is_baptized, year_of_salvation, row_version`,
      params,
    );
    await audit(this.pool, principal.userId, "milestone.updated", "users", memberId, input);
    return updated;
  }
}
