// Sync engine — delta pull + ordered idempotent push (§1.7, §3.6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addQuestion,
  createEvent,
} from "./helpers/factories.js";
import { SyncService } from "../src/modules/sync/service.js";
import { eventScanToken } from "../src/modules/progress/attendance.js";

const sync = () => new SyncService(testPool());
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

describe("sync engine (§3.6)", () => {
  let student: string, l1m1: string, l1m2: string, q: string, cong: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    const cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(student, 1);
    l1m1 = await createModule(1, 1);
    l1m2 = await createModule(1, 2);
    q = await addQuestion(l1m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("applies a module completion, and a replay is a duplicate", async () => {
    const push1 = await sync().push(student, {
      mutations: [{ mutation_id: uuid(1), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m1 } }],
    });
    expect(push1.results[0]).toMatchObject({ status: "applied" });

    const push2 = await sync().push(student, {
      mutations: [{ mutation_id: uuid(1), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m1 } }],
    });
    expect(push2.results[0]).toMatchObject({ status: "duplicate" });
  });

  it("replays an offline attendance scan, and a re-push is a duplicate (§1.7, §3.6)", async () => {
    const { event_id, qr_secret } = await createEvent(cong);
    const token = eventScanToken(qr_secret, event_id);

    const push1 = await sync().push(student, {
      mutations: [
        { mutation_id: uuid(20), seq: 1, domain: "attendance", op: "scan", payload: { event_id, scan_token: token } },
      ],
    });
    expect(push1.results[0]).toMatchObject({ status: "applied" });
    const logged = await testPool().query("SELECT count(*)::int n FROM attendance_logs WHERE user_id=$1", [student]);
    expect(logged.rows[0].n).toBe(1);

    const push2 = await sync().push(student, {
      mutations: [
        { mutation_id: uuid(20), seq: 1, domain: "attendance", op: "scan", payload: { event_id, scan_token: token } },
      ],
    });
    expect(push2.results[0]).toMatchObject({ status: "duplicate" });
  });

  it("rejects a locked-module completion with GATE_LOCKED (server-authoritative)", async () => {
    const res = await sync().push(student, {
      mutations: [{ mutation_id: uuid(2), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m2 } }],
    });
    expect(res.results[0]).toMatchObject({ status: "rejected", code: "GATE_LOCKED" });
  });

  it("refuses to queue money offline and rejects unknown mutations", async () => {
    const res = await sync().push(student, {
      mutations: [
        { mutation_id: uuid(3), seq: 1, domain: "giving", op: "intent", payload: { amount_minor: 1000 } },
        { mutation_id: uuid(4), seq: 2, domain: "bogus", op: "frobnicate" },
      ],
    });
    expect(res.results[0]?.status).toBe("rejected");
    expect(res.results[1]?.status).toBe("rejected");
  });

  it("applies an ordered batch (complete → quiz) in seq order", async () => {
    const res = await sync().push(student, {
      mutations: [
        { mutation_id: uuid(6), seq: 2, domain: "quiz_attempts", op: "submit", payload: { module_id: l1m1, answers: [{ question_id: q, given_answer: "A" }] } },
        { mutation_id: uuid(5), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m1 } },
      ],
    });
    // Returned in applied (seq) order: complete first, then quiz.
    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("pull returns changed rows since the cursor, then nothing on the next pull", async () => {
    await sync().push(student, {
      mutations: [{ mutation_id: uuid(7), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m1 } }],
    });

    const first = await sync().pull(student, { cursors: {} });
    expect(first.changes.module_progress?.length).toBe(1);
    expect(first.cursors.module_progress).toBeGreaterThan(0);

    const second = await sync().pull(student, { cursors: first.cursors });
    expect(second.changes.module_progress).toBeUndefined();
  });

  it("scopes pull to the caller — another member sees nothing", async () => {
    await sync().push(student, {
      mutations: [{ mutation_id: uuid(8), seq: 1, domain: "module_progress", op: "complete", payload: { module_id: l1m1 } }],
    });
    const cong = await createCongregation("Other");
    const other = (await createUser({ congregationId: cong })).user_id;
    const pull = await sync().pull(other, { cursors: {} });
    expect(pull.changes.module_progress).toBeUndefined();
  });
});
