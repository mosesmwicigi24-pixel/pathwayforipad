// Chat: DMs, cell groups, public spaces (mobile Chat make). Server-authoritative
// membership (§5.4), offline-queueable idempotent sends (§1.7/§3.6), minor-safe
// DMs (D-M6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createLeaderAssignment } from "./helpers/factories.js";

let cong: string, cellA: string, cellB: string;
let aId: string, aTok: string; // cellA
let a2Id: string, a2Tok: string; // cellA (same cell as a)
let bId: string, bTok: string; // cellB
let lId: string, leaderTok: string; // Instructor in cellA
let minorId: string, minorTok: string; // a minor in cellA
let adminTok: string; // Admin (not a member of any cell room)

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a@dev.local", fullName: "Ada" });
  const a2 = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a2@dev.local", fullName: "Ben" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "b@dev.local", fullName: "Cara" });
  const l = await createUser({ congregationId: cong, cellGroupId: cellA, role: "Instructor", email: "l@dev.local", fullName: "Lee" });
  const minor = await createUser({ congregationId: cong, cellGroupId: cellA, email: "m@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  expect(minor.is_minor).toBe(true);
  const admin = await createUser({ congregationId: cong, cellGroupId: cellB, role: "Admin", email: "admin@dev.local", fullName: "Admin" });
  aId = a.user_id; a2Id = a2.user_id; bId = b.user_id; lId = l.user_id; minorId = minor.user_id;
  aTok = bearer({ sub: a.user_id, role: "Student", cong });
  a2Tok = bearer({ sub: a2.user_id, role: "Student", cong });
  bTok = bearer({ sub: b.user_id, role: "Student", cong });
  leaderTok = bearer({ sub: l.user_id, role: "Instructor", cong });
  minorTok = bearer({ sub: minor.user_id, role: "Student", cong });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

async function groupId(tok: string): Promise<string> {
  const res = await agent().get("/v1/chat/conversations").set(auth(tok));
  const group = (res.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group");
  return group!.conversation_id;
}

describe("message edit / delete (author-only)", () => {
  it("author edits and soft-deletes their own message; others cannot", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(1), body: "frist draft", client_mutation_id: uuid(50) });

    // a non-author cannot edit or delete
    const otherEdit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(a2Tok)).send({ body: "hijack" });
    expect(otherEdit.status).toBe(404);
    const otherDel = await agent().delete(`/v1/chat/messages/${uuid(1)}`).set(auth(a2Tok));
    expect(otherDel.status).toBe(404);

    // author edits → body changes + is_edited flips
    const edit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok)).send({ body: "first draft, fixed" });
    expect(edit.status).toBe(200);
    let seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    const edited = (seen.body.messages as Array<{ message_id: string; body: string; is_edited: boolean }>).find((m) => m.message_id === uuid(1));
    expect(edited?.body).toBe("first draft, fixed");
    expect(edited?.is_edited).toBe(true);

    // author deletes → message disappears from everyone's read
    const del = await agent().delete(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok));
    expect(del.status).toBe(200);
    seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect((seen.body.messages as Array<{ message_id: string }>).some((m) => m.message_id === uuid(1))).toBe(false);

    // editing a deleted message 404s
    const reEdit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok)).send({ body: "back?" });
    expect(reEdit.status).toBe(404);
  });
});

describe("cell groups", () => {
  it("auto-provisions one group room per cell and members of the cell share it", async () => {
    const gA = await groupId(aTok);
    const gA2 = await groupId(a2Tok);
    expect(gA).toBe(gA2); // same cell → same room

    const gB = await groupId(bTok);
    expect(gB).not.toBe(gA); // different cell → different room
  });

  it("a cell member sees another member's message; an out-of-cell member gets 404", async () => {
    const g = await groupId(aTok);
    const sent = await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(1), body: "Grace and peace", client_mutation_id: uuid(50) });
    expect(sent.status).toBe(201);

    const seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect(seen.status).toBe(200);
    expect((seen.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("Grace and peace");

    const denied = await agent().get(`/v1/chat/conversations/${g}`).set(auth(bTok));
    expect(denied.status).toBe(404); // no existence leak across cells
  });

  it("send is idempotent on client_mutation_id", async () => {
    const g = await groupId(aTok);
    const send = () => agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(2), body: "once", client_mutation_id: uuid(51) });
    expect((await send()).status).toBe(201);
    const replay = await send();
    expect(replay.body.duplicate).toBe(true);
    const convo = await agent().get(`/v1/chat/conversations/${g}`).set(auth(aTok));
    expect((convo.body.messages as unknown[]).filter((m) => (m as { body: string }).body === "once")).toHaveLength(1);
  });
});

describe("unread + reactions", () => {
  it("unread clears after marking read", async () => {
    const g = await groupId(a2Tok); // a2 is a member
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(3), body: "hi" });
    let list = await agent().get("/v1/chat/conversations").set(auth(a2Tok));
    let group = (list.body.conversations as Array<{ conversation_id: string; unread: number }>).find((c) => c.conversation_id === g)!;
    expect(group.unread).toBeGreaterThanOrEqual(1);

    await agent().post(`/v1/chat/conversations/${g}/read`).set(auth(a2Tok)).send({});
    list = await agent().get("/v1/chat/conversations").set(auth(a2Tok));
    group = (list.body.conversations as Array<{ conversation_id: string; unread: number }>).find((c) => c.conversation_id === g)!;
    expect(group.unread).toBe(0);
  });

  it("toggles a reaction on and off", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(4), body: "amen" });
    const on = await agent().post(`/v1/chat/messages/${uuid(4)}/reactions`).set(auth(a2Tok)).send({ emoji: "🙏" });
    expect(on.body.on).toBe(true);
    const off = await agent().post(`/v1/chat/messages/${uuid(4)}/reactions`).set(auth(a2Tok)).send({ emoji: "🙏" });
    expect(off.body.on).toBe(false);
  });
});

describe("direct messages", () => {
  it("creates a DM, dedupes, and both members can read it", async () => {
    const made = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: a2Id });
    expect(made.status).toBe(201);
    const again = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: a2Id });
    expect(again.body.conversation_id).toBe(made.body.conversation_id); // deduped

    await agent().post(`/v1/chat/conversations/${made.body.conversation_id}/messages`).set(auth(aTok)).send({ message_id: uuid(5), body: "hey Ben" });
    const read = await agent().get(`/v1/chat/conversations/${made.body.conversation_id}`).set(auth(a2Tok));
    expect(read.status).toBe(200);
    expect(read.body.title).toBe("Ada"); // DM titled by the other member
  });

  it("blocks DMs with a minor (D-M6)", async () => {
    const res = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: minorId });
    expect(res.status).toBe(403);
  });
});

describe("public spaces", () => {
  it("a leader creates a space; a member discovers, joins, and posts", async () => {
    const created = await agent().post("/v1/chat/spaces").set(auth(leaderTok))
      .send({ conversation_id: uuid(9), title: "Worship Team", topic: "Sunday set lists" });
    expect(created.status).toBe(201);

    const discover = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((discover.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(9))).toBe(true);

    const joined = await agent().post(`/v1/chat/spaces/${uuid(9)}/join`).set(auth(aTok)).send({});
    expect(joined.body.joined).toBe(true);

    const post = await agent().post(`/v1/chat/conversations/${uuid(9)}/messages`).set(auth(aTok)).send({ message_id: uuid(10), body: "Excited to serve" });
    expect(post.status).toBe(201);

    // Now it shows up in their joined conversations, not discover.
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((list.body.conversations as Array<{ conversation_id: string }>).some((c) => c.conversation_id === uuid(9))).toBe(true);
    expect((list.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(9))).toBe(false);
  });

  it("carries a space category through discover, inbox, and the thread head", async () => {
    await agent().post("/v1/chat/spaces").set(auth(leaderTok))
      .send({ conversation_id: uuid(11), title: "Youth Ablaze", topic: "For the youth", category: "youth" });

    const discover = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const found = (discover.body.discover_spaces as Array<{ conversation_id: string; category: string }>).find((s) => s.conversation_id === uuid(11))!;
    expect(found.category).toBe("youth");

    await agent().post(`/v1/chat/spaces/${uuid(11)}/join`).set(auth(aTok)).send({});
    const head = await agent().get(`/v1/chat/conversations/${uuid(11)}`).set(auth(aTok));
    expect(head.body.category).toBe("youth");
    expect(head.body.member_count).toBeGreaterThanOrEqual(1);
  });
});

describe("moderation (Admin/SuperAdmin)", () => {
  it("admin flags a message — it shows is_flagged in the admin view", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(20), body: "needs a look" });

    const flag = await agent().post(`/v1/chat/messages/${uuid(20)}/flag`).set(auth(adminTok)).send({ reason: "review" });
    expect(flag.status).toBe(200);
    expect(flag.body.is_flagged).toBe(true);

    const adminView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    const msg = (adminView.body.messages as Array<{ message_id: string; is_flagged: boolean; flag_reason: string | null }>).find((m) => m.message_id === uuid(20))!;
    expect(msg.is_flagged).toBe(true);
    expect(msg.flag_reason).toBe("review");
  });

  it("admin removes a message — hidden from members, visible to admin as is_hidden", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(21), body: "to remove" });

    const removed = await agent().post(`/v1/chat/messages/${uuid(21)}/remove`).set(auth(adminTok)).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.is_hidden).toBe(true);

    const memberView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect((memberView.body.messages as Array<{ message_id: string }>).some((m) => m.message_id === uuid(21))).toBe(false);

    const adminView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    const msg = (adminView.body.messages as Array<{ message_id: string; is_hidden: boolean }>).find((m) => m.message_id === uuid(21))!;
    expect(msg.is_hidden).toBe(true);
  });

  it("a non-admin (Student) cannot moderate — 403", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(22), body: "hands off" });
    const denied = await agent().post(`/v1/chat/messages/${uuid(22)}/flag`).set(auth(a2Tok)).send({ reason: "x" });
    expect(denied.status).toBe(403);
  });

  it("admin can read a conversation they are not a member of", async () => {
    const g = await groupId(aTok); // cellA room; admin is in cellB
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(23), body: "for oversight" });
    const view = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    expect(view.status).toBe(200);
    expect((view.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("for oversight");
  });
});

describe("DM directory (people)", () => {
  it("lists same-congregation members, excluding self and minors", async () => {
    const res = await agent().get("/v1/chat/people").set(auth(aTok));
    expect(res.status).toBe(200);
    const ids = (res.body.people as Array<{ user_id: string }>).map((p) => p.user_id);
    expect(ids).toContain(a2Id); // a peer
    expect(ids).toContain(bId); // another cell, same congregation
    expect(ids).not.toContain(aId); // not self
    expect(ids).not.toContain(minorId); // minors never appear (D-M6)
  });

  it("filters by name search", async () => {
    const res = await agent().get("/v1/chat/people").query({ q: "ben" }).set(auth(aTok));
    const names = (res.body.people as Array<{ full_name: string }>).map((p) => p.full_name);
    expect(names).toEqual(["Ben"]);
  });

  it("a minor caller gets an empty directory (D-M6)", async () => {
    const res = await agent().get("/v1/chat/people").set(auth(minorTok));
    expect(res.status).toBe(200);
    expect(res.body.people).toEqual([]);
  });

  it("excludes users with a NULL congregation, and a NULL-congregation caller sees nobody", async () => {
    // An unattached user (e.g. a fresh self-signup) — congregation set to NULL.
    const orphan = await createUser({ congregationId: cong, email: "orphan@dev.local", fullName: "Orphan One" });
    await testPool().query("UPDATE users SET congregation_id = NULL WHERE user_id = $1", [orphan.user_id]);
    const orphanTok = bearer({ sub: orphan.user_id, role: "Student", cong });

    // The orphan never appears in another member's directory.
    const seen = await agent().get("/v1/chat/people").set(auth(aTok));
    expect((seen.body.people as Array<{ user_id: string }>).map((p) => p.user_id)).not.toContain(orphan.user_id);

    // The orphan (NULL congregation) sees nobody.
    const mine = await agent().get("/v1/chat/people").set(auth(orphanTok));
    expect(mine.status).toBe(200);
    expect(mine.body.people).toEqual([]);
  });
});

describe("cell conversation (portal Message cell)", () => {
  it("a scoped leader opens their cell's group room (same id as the auto-provisioned room)", async () => {
    await createLeaderAssignment(lId, cellA);
    const opened = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(leaderTok)).send({});
    expect(opened.status).toBe(201);
    // It is the very room cell members already share.
    const memberRoom = await groupId(aTok);
    expect(opened.body.conversation_id).toBe(memberRoom);

    // The leader is now a member and can read it.
    const view = await agent().get(`/v1/chat/conversations/${opened.body.conversation_id}`).set(auth(leaderTok));
    expect(view.status).toBe(200);
  });

  it("an Admin opens any cell's room without a leader_assignment", async () => {
    const opened = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(adminTok)).send({});
    expect(opened.status).toBe(201);
  });

  it("an out-of-scope leader is refused (403 FORBIDDEN_SCOPE)", async () => {
    // Lee is assigned to cellA only → cellB is out of scope.
    await createLeaderAssignment(lId, cellA);
    const denied = await agent().post(`/v1/chat/cells/${cellB}/conversation`).set(auth(leaderTok)).send({});
    expect(denied.status).toBe(403);
  });

  it("a plain Student cannot open a cell room (insufficient role)", async () => {
    const denied = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(aTok)).send({});
    expect(denied.status).toBe(403);
  });
});

// keep references used (lint)
void aId;
