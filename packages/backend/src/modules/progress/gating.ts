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
  start_level: number;
  start_module_sequence: number;
}

/**
 * The first module sequence a member is responsible for in a given level. For
 * the level they were placed at (start_level) this is start_module_sequence —
 * modules before it are treated as covered by the placement. Every other level
 * starts at 1. Drives both unlock (entry is open) and advancement (skipped
 * modules aren't required). Defaults of (1, 1) make this always return 1.
 */
export function entryFloorSeq(enrollment: EnrollmentRef, levelNumber: number): number {
  return levelNumber === enrollment.start_level ? enrollment.start_module_sequence : 1;
}

interface ModuleRow {
  module_id: string;
  level_number: number;
  module_sequence_number: number;
}

/**
 * The pathway's universal entry point — Level 1, Module 1. Always open so every
 * member has a way in (even before an enrollment exists). This is the floor of the
 * curriculum, so opening it exposes no higher content; the hard-lock invariant
 * still protects everything above the member's current_level.
 */
export function isEntryModule(levelNumber: number, moduleSequenceNumber: number): boolean {
  return levelNumber === 1 && moduleSequenceNumber === 1;
}

export async function loadEnrollment(c: Queryable, userId: string): Promise<EnrollmentRef | null> {
  return maybeOne<EnrollmentRef>(
    c,
    `SELECT enrollment_id, current_level, start_level, start_module_sequence
       FROM enrollments WHERE user_id = $1`,
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
 * SQL predicate: is a module "passed" for unlocking the next one (§1.9 Phase C)?
 * Driven by the module's `evaluation_kind`, given a module row aliased `mod`
 * (has evaluation_kind, module_id) and its COMPLETED module_progress row aliased
 * `mp` (has reflection_text, progress_id). Completion is asserted by the caller;
 * this adds the per-kind requirement:
 *   none / exit_exam → nothing extra (completion alone unlocks the next)
 *   reflection       → a reflection exists and was not sent back ('returned'
 *                      re-locks until resubmitted; pending/approved/deferred pass)
 *   quiz             → a passing quiz attempt (or the module has no active questions)
 */
export function modulePassedPredicate(mod: string, mp: string): string {
  return `(CASE ${mod}.evaluation_kind
      WHEN 'reflection' THEN EXISTS (
        SELECT 1 FROM module_reflections mr
         WHERE mr.progress_id = ${mp}.progress_id AND mr.state <> 'returned'
      )
      WHEN 'quiz' THEN (
        NOT EXISTS (SELECT 1 FROM question_bank q WHERE q.module_id = ${mod}.module_id AND q.is_active)
        OR EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.progress_id = ${mp}.progress_id AND qa.is_passed)
      )
      ELSE TRUE
    END)`;
}

/**
 * Is `module` unlocked for `enrollment`? Enforces the hard lock (level ceiling)
 * and the sequential-prerequisite rule (previous module completed AND, per its
 * evaluation_kind, passed). The first module of an unlocked level is always open.
 */
export async function isModuleUnlocked(
  c: Queryable,
  enrollment: EnrollmentRef,
  module: ModuleRow,
): Promise<boolean> {
  // Universal entry point: Level 1 · Module 1 is always open (§1.9 floor).
  if (isEntryModule(module.level_number, module.module_sequence_number)) return true;
  // Hard lock: nothing above the member's current level (§1.9 invariant).
  if (module.level_number > enrollment.current_level) return false;
  // Levels strictly below the current one are fully unlocked (already passed).
  if (module.level_number < enrollment.current_level) return true;
  // Admin-set entry point: the entry module and any modules before it in the
  // placed level are open (the member begins here; defaults make this seq 1 only).
  if (module.module_sequence_number <= entryFloorSeq(enrollment, module.level_number)) return true;

  const row = await maybeOne<{ unlocked: boolean }>(
    c,
    `WITH prereq AS (
        SELECT m2.module_id, m2.evaluation_kind
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
          AND ${modulePassedPredicate("p", "mp")}
     ) AS unlocked`,
    [module.module_id, enrollment.enrollment_id],
  );
  return row?.unlocked ?? false;
}
