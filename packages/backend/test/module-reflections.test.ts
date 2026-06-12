// Module reflections (Contract Matrix B3): submit → pending; reviewer approve/
// return/defer; 'returned' RE-LOCKS gating until resubmitted; pastoral note never
// reaches the member (API or sync); queue is cell-scoped; decisions notify.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  createLeaderAssignment,
} from "./helpers/factories.js";
import { SyncService } from "../src/modules/sync/service.js";

let cong: string, cellA: string, cellB: string;
let leaderId: string, memberId: string;
let leaderTok: string, memberTok: string, outsiderTok: string;
let m1: string, m2: string;

const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" });
  const outsider = await createUser({ congregationId: cong, role: "Instructor", email: "o@dev.local" });
  const member = await createUser({ congregationId: cong, cellGroupId: cellA, role: "Student", email: "m@dev.local" });
  leaderId = leader.user_id;
  memberId = member.user_id;
  await createLeaderAssignment(leaderId, cellA);
  await createLeaderAssignment(outsider.user_id, cellB); // leads a different cell
  await createEnrollment(memberId, 1);
  leaderTok = bearer({ sub: leaderId, role: "Instructor", cong });
  outsiderTok = bearer({ sub: outsider.user_id, role: "Instructor", cong });
  memberTok = bearer({ sub: memberId, role: "Student", cong });
  m1 = await createModule(1, 1, { evaluationKind: "reflection" });
  m2 = await createModule(1, 2, { evaluationKind: "none" });
});
afterAll(async () => {
  await closeTestPool();
});

async function submitReflection(text: string): Promise<void> {
  const res = await agent()
    .post(`/v1/modules/${m1}/complete`)
    .set(auth(memberTok))
    .send({ reflection_text: text });
  expect(res.status).toBe(200);
}

async function nextUnlocked(): Promise<boolean> {
  const mods = await agent().get("/v1/levels/1/modules").set(auth(memberTok));
  const next = mods.body.data.find((m: { module_id: string }) => m.module_id === m2);
  return !next.locked;
}

describe("review lifecycle + gating", () => {
  it("submit → pending (passes gating); RETURN re-locks; resubmit → pending again; approve passes", async () => {
    await submitReflection("My first draft");
    expect(await nextUnlocked()).toBe(true); // pending does not block

    const queue = await agent().get("/v1/admin/reflections").set(auth(leaderTok));
    expect(queue.body.data).toHaveLength(1);
    const reflectionId = queue.body.data[0].reflection_id;
    expect(queue.body.data[0].state).toBe("pending");

    // Return requires feedback for the member.
    const noFeedback = await agent()
      .post(`/v1/admin/reflections/${reflectionId}/decision`)
      .set(auth(leaderTok))
      .send({ decision: "return" });
    expect(noFeedback.status).toBe(400);

    const returned = await agent()
      .post(`/v1/admin/reflections/${reflectionId}/decision`)
      .set(auth(leaderTok))
      .send({ decision: "return", feedback_notes: "Go deeper on application", pastoral_note: "watch this one" });
    expect(returned.status).toBe(200);
    expect(await nextUnlocked()).toBe(false); // RETURNED re-locks the next module

    // Member sees state + feedback but never the pastoral note.
    const mine = await agent().get(`/v1/modules/${m1}/reflection`).set(auth(memberTok));
    expect(mine.body.state).toBe("returned");
    expect(mine.body.feedback_notes).toBe("Go deeper on application");
    expect(mine.body.pastoral_note).toBeUndefined();

    // Resubmission re-enters pending and unlocks again.
    await submitReflection("My deeper second draft");
    expect(await nextUnlocked()).toBe(true);
    const requeued = await agent().get("/v1/admin/reflections").set(auth(leaderTok));
    expect(requeued.body.data[0].state).toBe("pending");
    expect(requeued.body.data[0].body).toBe("My deeper second draft");

    const approved = await agent()
      .post(`/v1/admin/reflections/${reflectionId}/decision`)
      .set(auth(leaderTok))
      .send({ decision: "approve" });
    expect(approved.status).toBe(200);
    expect(await nextUnlocked()).toBe(true);

    // Member was notified on each decision; history shows the trail.
    const notes = await testPool().query(
      `SELECT template FROM notifications WHERE user_id=$1 AND template LIKE 'reflection_%'`,
      [memberId],
    );
    expect(notes.rows.map((r) => r.template).sort()).toEqual(["reflection_approved", "reflection_returned"]);

    const history = await agent().get(`/v1/admin/reflections/${reflectionId}/history`).set(auth(leaderTok));
    expect(history.body.data.map((h: { action: string }) => h.action)).toEqual(["reflection.approve", "reflection.return"]);
  });

  it("DEFER parks the reflection without blocking gating", async () => {
    await submitReflection("Thoughts");
    const queue = await agent().get("/v1/admin/reflections").set(auth(leaderTok));
    const reflectionId = queue.body.data[0].reflection_id;
    await agent()
      .post(`/v1/admin/reflections/${reflectionId}/decision`)
      .set(auth(leaderTok))
      .send({ decision: "defer" });
    expect(await nextUnlocked()).toBe(true);
    const deferred = await agent().get("/v1/admin/reflections").set(auth(leaderTok)).query({ state: "deferred" });
    expect(deferred.body.data).toHaveLength(1);
  });
});

describe("scoping + privacy", () => {
  it("an instructor of another cell sees an empty queue and cannot decide", async () => {
    await submitReflection("Scoped");
    const queue = await agent().get("/v1/admin/reflections").set(auth(outsiderTok));
    expect(queue.body.data).toHaveLength(0);

    const id = (await testPool().query("SELECT reflection_id FROM module_reflections LIMIT 1")).rows[0].reflection_id;
    const denied = await agent()
      .post(`/v1/admin/reflections/${id}/decision`)
      .set(auth(outsiderTok))
      .send({ decision: "approve" });
    expect(denied.status).toBe(403);

    const memberDenied = await agent().get("/v1/admin/reflections").set(auth(memberTok));
    expect(memberDenied.status).toBe(403);
  });

  it("sync pull exposes the member's reflection WITHOUT the pastoral note", async () => {
    await submitReflection("Sync me");
    const id = (await testPool().query("SELECT reflection_id FROM module_reflections LIMIT 1")).rows[0].reflection_id;
    await agent()
      .post(`/v1/admin/reflections/${id}/decision`)
      .set(auth(leaderTok))
      .send({ decision: "approve", pastoral_note: "internal-only words" });

    const sync = new SyncService(testPool());
    const pulled = await sync.pull(memberId, { cursors: {} });
    const rows = pulled.changes.module_reflections ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!.row as Record<string, unknown>;
    expect(row.state).toBe("approved");
    expect("pastoral_note" in row).toBe(false); // never synced to the device
  });
});
