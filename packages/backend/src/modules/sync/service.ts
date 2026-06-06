// Sync engine (spec §1.7, §3.6). Two independent flows so a slow push never
// blocks a fast pull:
//   • pull  — client sends per-domain cursors; server returns rows changed since
//             (from change_log), tombstones for deletions, and new cursors.
//   • push  — client replays its ordered pending_mutations; each is applied in
//             seq order against the authoritative service, with a per-mutation
//             result. Idempotency keys make replays safe.
// Conflict policy is per record class (§3.6): append-only events are no-ops on
// replay, progress is monotonic, profile edits are version-checked, gating is
// server-only, and money is never queued offline (rejected here).
import type { Pool, PoolClient } from "pg";
import { many, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { ProgressService } from "../progress/service.js";
import { AssessmentService } from "../assessment/service.js";
import { ExamService } from "../assessment/exam.js";

interface DomainSpec {
  table: string;
  idCol: string;
  scope: "row" | "global" | "user";
}

// Server-pullable domains → how to materialise their current rows. Table/column
// names are fixed here (never client-supplied), so interpolation is safe.
const PULL_DOMAINS: Record<string, DomainSpec> = {
  modules: { table: "modules", idCol: "module_id", scope: "global" },
  module_progress: { table: "module_progress", idCol: "progress_id", scope: "row" },
  quiz_attempts: { table: "quiz_attempts", idCol: "attempt_id", scope: "row" },
  level_exam_attempts: { table: "level_exam_attempts", idCol: "exam_attempt_id", scope: "row" },
  enrollments: { table: "enrollments", idCol: "enrollment_id", scope: "user" },
};

const PAGE = 1000;

export interface PullRequest {
  device_id?: string | undefined;
  cursors?: Record<string, number> | undefined;
}

export interface MutationResult {
  mutation_id: string;
  status: "applied" | "duplicate" | "rejected";
  code?: string;
  detail?: string;
}

export interface PushRequest {
  device_id?: string | undefined;
  mutations: Array<{
    mutation_id: string;
    seq: number;
    domain: string;
    op: string;
    payload?: Record<string, unknown> | undefined;
  }>;
}

export class SyncService {
  private readonly progress: ProgressService;
  private readonly assessment: AssessmentService;
  private readonly exams: ExamService;

  constructor(private readonly pool: Pool) {
    this.progress = new ProgressService(pool);
    this.assessment = new AssessmentService(pool);
    this.exams = new ExamService(pool);
  }

  /** Delta pull: changed rows + tombstones + new cursors since the client's cursors. */
  async pull(userId: string, req: PullRequest): Promise<{
    changes: Record<string, Array<{ op: "upsert"; row: Record<string, unknown> }>>;
    tombstones: Record<string, string[]>;
    cursors: Record<string, number>;
  }> {
    const cursors = req.cursors ?? {};
    const changes: Record<string, Array<{ op: "upsert"; row: Record<string, unknown> }>> = {};
    const tombstones: Record<string, string[]> = {};
    const newCursors: Record<string, number> = {};

    for (const [domain, spec] of Object.entries(PULL_DOMAINS)) {
      const since = Number(cursors[domain] ?? 0);
      const entries = await many<{ change_id: string; row_id: string | null; op: string }>(
        this.pool,
        `SELECT change_id, row_id, op
           FROM change_log
          WHERE domain = $1 AND change_id > $2 AND (user_id = $3 OR user_id IS NULL)
          ORDER BY change_id ASC
          LIMIT ${PAGE}`,
        [domain, since, userId],
      );
      if (entries.length === 0) continue;

      const maxId = Number(entries[entries.length - 1]!.change_id);
      const upsertIds = [
        ...new Set(entries.filter((e) => e.op !== "delete" && e.row_id).map((e) => e.row_id as string)),
      ];
      const deleteIds = entries.filter((e) => e.op === "delete" && e.row_id).map((e) => e.row_id as string);

      const rows = await this.fetchRows(this.pool, spec, userId, upsertIds);
      const found = new Set(rows.map((r) => String(r[spec.idCol])));
      // An upsert whose row no longer exists became a deletion in the meantime.
      const missing = spec.scope === "user" ? [] : upsertIds.filter((id) => !found.has(id));

      if (rows.length > 0) changes[domain] = rows.map((row) => ({ op: "upsert", row }));
      const tomb = [...new Set([...deleteIds, ...missing])];
      if (tomb.length > 0) tombstones[domain] = tomb;
      newCursors[domain] = maxId;
    }

    return { changes, tombstones, cursors: newCursors };
  }

  private fetchRows(
    c: Queryable,
    spec: DomainSpec,
    userId: string,
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (spec.scope === "user") {
      return many(c, `SELECT * FROM ${spec.table} WHERE user_id = $1`, [userId]);
    }
    if (ids.length === 0) return Promise.resolve([]);
    return many(c, `SELECT * FROM ${spec.table} WHERE ${spec.idCol} = ANY($1::uuid[])`, [ids]);
  }

  /** Ordered, idempotent mutation replay. Each mutation gets its own result. */
  async push(userId: string, req: PushRequest): Promise<{ results: MutationResult[] }> {
    const ordered = [...req.mutations].sort((a, b) => a.seq - b.seq); // never reordered beyond seq
    const results: MutationResult[] = [];
    for (const m of ordered) {
      try {
        const duplicate = await this.apply(userId, m);
        results.push({ mutation_id: m.mutation_id, status: duplicate ? "duplicate" : "applied" });
      } catch (err) {
        if (err instanceof ApiError) {
          results.push({ mutation_id: m.mutation_id, status: "rejected", code: err.code, detail: err.message });
        } else {
          results.push({ mutation_id: m.mutation_id, status: "rejected", code: "INTERNAL", detail: "Internal error" });
        }
      }
    }
    return { results };
  }

  /** Dispatch one mutation to its authoritative service. Returns whether it was a duplicate. */
  private async apply(
    userId: string,
    m: { mutation_id: string; domain: string; op: string; payload?: Record<string, unknown> | undefined },
  ): Promise<boolean> {
    const p = m.payload ?? {};
    const key = `${m.domain}:${m.op}`;
    switch (key) {
      case "module_progress:complete": {
        const moduleId = String(p.module_id ?? "");
        const r = await this.progress.completeModule(
          userId,
          moduleId,
          m.mutation_id,
          typeof p.completed_at === "string" ? p.completed_at : undefined,
          typeof p.reflection_text === "string" ? p.reflection_text : undefined,
        );
        return r.duplicate;
      }
      case "quiz_attempts:submit": {
        const r = await this.assessment.submitQuiz(userId, String(p.module_id ?? ""), {
          client_mutation_id: m.mutation_id,
          answers: this.answers(p),
        });
        return r.duplicate;
      }
      case "level_exam_attempts:submit": {
        const r = await this.exams.submit(userId, Number(p.level_number), {
          client_mutation_id: m.mutation_id,
          answers: this.answers(p),
        });
        return r.duplicate;
      }
      case "interaction_events:record":
        return this.recordInteraction(userId, m.mutation_id, p);
      default:
        // Money is never queued offline (§3.6); everything unknown is rejected loudly.
        if (m.domain === "transactions" || m.domain === "giving" || m.domain === "financial") {
          throw new ApiError("VALIDATION_FAILED", "Financial actions cannot be queued offline", {
            code: "OFFLINE_FORBIDDEN",
          });
        }
        throw new ApiError("VALIDATION_FAILED", `Unsupported mutation ${key}`);
    }
  }

  private answers(p: Record<string, unknown>): Array<{ question_id: string; given_answer: string }> {
    const raw = Array.isArray(p.answers) ? p.answers : [];
    return raw.map((a) => {
      const o = a as Record<string, unknown>;
      return { question_id: String(o.question_id ?? ""), given_answer: String(o.given_answer ?? "") };
    });
  }

  /** Append-only Hᵢ signal (§2.2 interaction_events). Idempotent on (client_event_id, occurred_at). */
  private async recordInteraction(
    userId: string,
    mutationId: string,
    p: Record<string, unknown>,
  ): Promise<boolean> {
    const occurredAt = typeof p.occurred_at === "string" ? p.occurred_at : new Date().toISOString();
    const res = await (this.pool as Pool | PoolClient).query(
      `INSERT INTO interaction_events (user_id, kind, module_id, occurred_at, client_event_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_event_id, occurred_at) DO NOTHING
       RETURNING event_id`,
      [userId, String(p.kind ?? "lesson_open"), p.module_id ?? null, occurredAt, mutationId],
    );
    return res.rowCount === 0; // nothing inserted ⇒ duplicate replay
  }
}
