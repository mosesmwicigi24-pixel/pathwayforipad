// Progress service (spec §1.5, §1.9, §3.3). Module completion with offline
// idempotency and forward-only (monotonic) merge — a stale client claiming
// "incomplete" never overwrites a server "complete" (§1.7).
import type { Pool, PoolClient } from "pg";
import { maybeOne, one, tx, recordChange, enqueueOutbox } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, loadModule, isModuleUnlocked, type EnrollmentRef } from "./gating.js";

export interface CompleteResult {
  progress_id: string;
  module_id: string;
  is_completed: boolean;
  duplicate: boolean;
  next_module_unlocked: boolean;
}

export class ProgressService {
  constructor(private readonly pool: Pool) {}

  async completeModule(
    userId: string,
    moduleId: string,
    clientMutationId: string | null,
    completedAt?: string,
    reflectionText?: string,
  ): Promise<CompleteResult> {
    return tx(this.pool, async (c) => {
      // Offline idempotency: a replayed mutation id is a no-op returning the prior result.
      if (clientMutationId) {
        const dup = await maybeOne<{ progress_id: string; module_id: string; is_completed: boolean }>(
          c,
          `SELECT progress_id, module_id, is_completed FROM module_progress WHERE client_mutation_id = $1`,
          [clientMutationId],
        );
        if (dup) {
          return {
            progress_id: dup.progress_id,
            module_id: dup.module_id,
            is_completed: dup.is_completed,
            duplicate: true,
            next_module_unlocked: await this.nextUnlocked(c, userId, moduleId),
          };
        }
      }

      const enrollment = await loadEnrollment(c, userId);
      if (!enrollment) throw new ApiError("UNPROCESSABLE", "No active enrollment");
      const module = await loadModule(c, moduleId);
      if (!module) throw new ApiError("NOT_FOUND", "Module not found");
      if (!(await isModuleUnlocked(c, enrollment, module))) {
        throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
          module_sequence_number: module.module_sequence_number,
        });
      }

      // Forward-only upsert: completion only moves forward (§1.7 monotonic merge).
      const row = await one<{ progress_id: string; is_completed: boolean }>(
        c,
        `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at, client_mutation_id, reflection_text)
         VALUES ($1,$2,TRUE,$3,$4,$5)
         ON CONFLICT (enrollment_id, module_id) DO UPDATE
           SET is_completed = TRUE,
               completed_at = COALESCE(module_progress.completed_at, EXCLUDED.completed_at),
               client_mutation_id = COALESCE(module_progress.client_mutation_id, EXCLUDED.client_mutation_id),
               reflection_text = COALESCE(EXCLUDED.reflection_text, module_progress.reflection_text),
               row_version = module_progress.row_version + 1
         RETURNING progress_id, is_completed`,
        [enrollment.enrollment_id, moduleId, completedAt ?? new Date().toISOString(), clientMutationId, reflectionText ?? null],
      );

      await recordChange(c, "module_progress", row.progress_id, userId, "upsert");
      // Verified signal → re-evaluate faithfulness badges (§G.3). Idempotent worker.
      await enqueueOutbox(c, "gamification.evaluate", { user_id: userId });
      return {
        progress_id: row.progress_id,
        module_id: moduleId,
        is_completed: row.is_completed,
        duplicate: false,
        next_module_unlocked: await this.nextUnlocked(c, userId, moduleId),
      };
    });
  }

  /** Is the module immediately after `moduleId` (same level) now unlocked? */
  private async nextUnlocked(c: Pool | PoolClient, userId: string, moduleId: string): Promise<boolean> {
    const enrollment = await loadEnrollment(c, userId);
    if (!enrollment) return false;
    const next = await maybeOne<{ module_id: string; level_number: number; module_sequence_number: number }>(
      c,
      `SELECT n.module_id, n.level_number, n.module_sequence_number
         FROM modules cur
         JOIN modules n ON n.level_number = cur.level_number
          AND n.module_sequence_number = cur.module_sequence_number + 1
        WHERE cur.module_id = $1`,
      [moduleId],
    );
    if (!next) return false;
    return isModuleUnlocked(c, enrollment as EnrollmentRef, next);
  }
}
