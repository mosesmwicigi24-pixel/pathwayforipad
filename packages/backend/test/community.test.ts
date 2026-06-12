// Community: cohort discussions (Contract Matrix B8). Cell-scoped visibility,
// leader moderation within leader_assignments (§5.4), offline-queueable posts,
// and the new "cell" sync scope (hidden/out-of-scope rows tombstone off devices).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createLeaderAssignment } from "./helpers/factories.js";

let cong: string, cellA: string, cellB: string;
let memberA: string, memberATok: string; // in cellA
let memberBTok: string; // in cellB
let leaderATok: string; // Instructor assigned to cellA only
let leaderBTok: string; // Instructor assigned to cellB only
let homelessTok: string; // member with no cell

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a@dev.local" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "b@dev.local" });
  const la = await createUser({ congregationId: cong, cellGroupId: cellA, role: "Instructor", email: "la@dev.local" });
  const lb = await createUser({ congregationId: cong, cellGroupId: cellB, role: "Instructor", email: "lb@dev.local" });
  const h = await createUser({ congregationId: cong, email: "h@dev.local" });
  await createLeaderAssignment(la.user_id, cellA);
  await createLeaderAssignment(lb.user_id, cellB);
  memberA = a.user_id;
  memberATok = bearer({ sub: a.user_id, role: "Student", cong });
  memberBTok = bearer({ sub: b.user_id, role: "Student", cong });
  leaderATok = bearer({ sub: la.user_id, role: "Instructor", cong });
  leaderBTok = bearer({ sub: lb.user_id, role: "Instructor", cong });
  homelessTok = bearer({ sub: h.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

async function postThread(tok: string, n: number, title = "Week 3 discussion") {
  return agent()
    .post("/v1/community/threads")
    .set(auth(tok))
    .send({ thread_id: uuid(n), title, body: "What stood out to you?", client_mutation_id: uuid(n + 50) });
}

describe("cell-scoped discussions", () => {
  it("threads live in the author's cell; other cells get a 404, no existence leak", async () => {
    const created = await postThread(memberATok, 1);
    expect(created.status).toBe(201);

    // Replay (same client_mutation_id + id) is a no-op.
    const replay = await postThread(memberATok, 1);
    expect(replay.body.duplicate).toBe(true);

    const mineList = await agent().get("/v1/community/threads").set(auth(memberATok));
    expect(mineList.body.data).toHaveLength(1);
    expect(mineList.body.data[0].author_name).toBe("Test Member");

    const otherList = await agent().get("/v1/community/threads").set(auth(memberBTok));
    expect(otherList.body.data).toHaveLength(0);
    const otherGet = await agent().get(`/v1/community/threads/${uuid(1)}`).set(auth(memberBTok));
    expect(otherGet.status).toBe(404);

    // No cell → clear 422, not a crash.
    const homeless = await agent().get("/v1/community/threads").set(auth(homelessTok));
    expect(homeless.status).toBe(422);
  });

  it("comments thread within the cell, respect locking, and replay idempotently", async () => {
    await postThread(memberATok, 2);
    const comment = await agent()
      .post(`/v1/community/threads/${uuid(2)}/comments`)
      .set(auth(memberATok))
      .send({ comment_id: uuid(3), body: "The grace part.", client_mutation_id: uuid(53) });
    expect(comment.status).toBe(201);

    // Cross-cell comment → 404 (scope), not 422.
    const foreign = await agent()
      .post(`/v1/community/threads/${uuid(2)}/comments`)
      .set(auth(memberBTok))
      .send({ comment_id: uuid(4), body: "intruding" });
    expect(foreign.status).toBe(404);

    // Leader locks the thread → new comments 422; existing remain visible.
    const lock = await agent()
      .patch(`/v1/admin/community/threads/${uuid(2)}`)
      .set(auth(leaderATok))
      .send({ locked: true });
    expect(lock.status).toBe(200);
    const afterLock = await agent()
      .post(`/v1/community/threads/${uuid(2)}/comments`)
      .set(auth(memberATok))
      .send({ comment_id: uuid(5), body: "too late" });
    expect(afterLock.status).toBe(422);

    const view = await agent().get(`/v1/community/threads/${uuid(2)}`).set(auth(memberATok));
    expect(view.body.comments).toHaveLength(1);
    expect(view.body.is_locked).toBe(true);
  });

  it("moderation is scope-enforced: the other cell's leader gets 403, the right one can pin/hide", async () => {
    await postThread(memberATok, 6);

    const wrongLeader = await agent()
      .patch(`/v1/admin/community/threads/${uuid(6)}`)
      .set(auth(leaderBTok))
      .send({ hidden: true });
    expect(wrongLeader.status).toBe(403); // FORBIDDEN_SCOPE (§5.4)

    const pin = await agent()
      .patch(`/v1/admin/community/threads/${uuid(6)}`)
      .set(auth(leaderATok))
      .send({ pinned: true });
    expect(pin.body.is_pinned).toBe(true);

    const hide = await agent()
      .patch(`/v1/admin/community/threads/${uuid(6)}`)
      .set(auth(leaderATok))
      .send({ hidden: true });
    expect(hide.body.is_hidden).toBe(true);

    // Hidden thread vanishes for members (list + direct fetch).
    expect((await agent().get("/v1/community/threads").set(auth(memberATok))).body.data).toHaveLength(0);
    expect((await agent().get(`/v1/community/threads/${uuid(6)}`).set(auth(memberATok))).status).toBe(404);

    // Members cannot reach moderation routes at all.
    const member = await agent()
      .patch(`/v1/admin/community/threads/${uuid(6)}`)
      .set(auth(memberATok))
      .send({ pinned: true });
    expect(member.status).toBe(403);
  });
});

describe("offline sync (new 'cell' scope)", () => {
  it("queued posts replay idempotently and pull only into same-cell devices", async () => {
    const push = await agent()
      .post("/v1/sync/push")
      .set(auth(memberATok))
      .send({
        mutations: [
          { mutation_id: uuid(60), seq: 1, domain: "discussion_threads", op: "create",
            payload: { thread_id: uuid(7), title: "Offline thread", body: "queued on the bus" } },
          { mutation_id: uuid(61), seq: 2, domain: "discussion_comments", op: "create",
            payload: { comment_id: uuid(8), thread_id: uuid(7), body: "first!" } },
          { mutation_id: uuid(60), seq: 3, domain: "discussion_threads", op: "create",
            payload: { thread_id: uuid(7), title: "Offline thread", body: "queued on the bus" } },
        ],
      });
    expect(push.body.results.map((r: { status: string }) => r.status)).toEqual(["applied", "applied", "duplicate"]);

    // Same-cell device pulls both rows (moderation metadata never ships).
    const pullA = await agent().post("/v1/sync/pull").set(auth(memberATok)).send({});
    expect(pullA.body.changes.discussion_threads).toHaveLength(1);
    expect(pullA.body.changes.discussion_threads[0].row).not.toHaveProperty("is_hidden");
    expect(pullA.body.changes.discussion_comments).toHaveLength(1);

    // Other-cell device gets tombstones, not content.
    const pullB = await agent().post("/v1/sync/pull").set(auth(memberBTok)).send({});
    expect(pullB.body.changes.discussion_threads ?? []).toHaveLength(0);
    expect(pullB.body.tombstones.discussion_threads).toContain(uuid(7));
  });

  it("hiding a thread tombstones it off same-cell devices on the next pull", async () => {
    await postThread(memberATok, 9);
    const pull1 = await agent().post("/v1/sync/pull").set(auth(memberATok)).send({});
    expect(pull1.body.changes.discussion_threads).toHaveLength(1);

    await agent().patch(`/v1/admin/community/threads/${uuid(9)}`).set(auth(leaderATok)).send({ hidden: true });

    const pull2 = await agent().post("/v1/sync/pull").set(auth(memberATok)).send({ cursors: pull1.body.cursors });
    expect(pull2.body.tombstones.discussion_threads).toContain(uuid(9));

    // The row itself survives server-side for the audit trail.
    const row = await testPool().query(`SELECT is_hidden, hidden_by FROM discussion_threads WHERE thread_id=$1`, [uuid(9)]);
    expect(row.rows[0].is_hidden).toBe(true);
    expect(row.rows[0].hidden_by).not.toBeNull();
  });
});
