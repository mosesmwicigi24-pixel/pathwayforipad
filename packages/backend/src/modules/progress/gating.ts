// Gating engine (spec §1.9). A pure server-side function over progress state; it
// never trusts the client. Composes the three rules:
//   1. Sequential modules — module n unlocks only when n−1 is complete AND its
//      quiz passed at/above the pass mark (a module with no active questions is
//      considered passed on completion).
//   2. Level exam — the last module unlocks the level exam (handled in assessment).
//   3. Reflection gate — level advancement needs an approved reflection (handled
//      in assessment/review).
// Plus the HARD-LOCK INVARIANT: no content above the member's current_level is
// ever unlocked, regardless of client claims.
import type { Queryable } from "../../db/db.js";
import { maybeOne } from "../../db/db.js";

export interface EnrollmentRef {
  enrollment_id: string;
  current_level: number;
}

interface ModuleRow {
  module_id: string;
  level_number: number;
  module_sequence_number: number;
}

export async function loadEnrollment(c: Queryable, userId: string): Promise<EnrollmentRef | null> {
  return maybeOne<EnrollmentRef>(
    c,
    `SELECT enrollment_id, current_level FROM enrollments WHERE user_id = $1`,
    [userId],
  );
}

export async function loadModule(c: Queryable, moduleId: string): Promise<ModuleRow | null> {
  return maybeOne<ModuleRow>(
    c,
    `SELECT module_id, level_number, module_sequence_number FROM modules WHERE module_id = $1`,
    [moduleId],
  );
}

/**
 * Is `module` unlocked for `enrollment`? Enforces the hard lock (level ceiling)
 * and the sequential-prerequisite rule (previous module completed AND its quiz
 * passed). The first module of an unlocked level is always open.
 */
export async function isModuleUnlocked(
  c: Queryable,
  enrollment: EnrollmentRef,
  module: ModuleRow,
): Promise<boolean> {
  // Hard lock: nothing above the member's current level (§1.9 invariant).
  if (module.level_number > enrollment.current_level) return false;
  // Levels strictly below the current one are fully unlocked (already passed).
  if (module.level_number < enrollment.current_level) return true;
  // First module of the active level is always open.
  if (module.module_sequence_number === 1) return true;

  const row = await maybeOne<{ unlocked: boolean }>(
    c,
    `WITH prereq AS (
        SELECT m2.module_id
          FROM modules m1
          JOIN modules m2
            ON m2.level_number = m1.level_number
           AND m2.module_sequence_number = m1.module_sequence_number - 1
         WHERE m1.module_id = $1
     )
     SELECT EXISTS (
       SELECT 1
         FROM module_progress mp
         JOIN prereq p ON p.module_id = mp.module_id
        WHERE mp.enrollment_id = $2
          AND mp.is_completed
          AND (
            NOT EXISTS (SELECT 1 FROM question_bank q WHERE q.module_id = mp.module_id AND q.is_active)
            OR EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.progress_id = mp.progress_id AND qa.is_passed)
          )
     ) AS unlocked`,
    [module.module_id, enrollment.enrollment_id],
  );
  return row?.unlocked ?? false;
}
