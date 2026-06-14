// Chat: DMs, cell groups, public spaces (mobile Chat make). Server-authoritative
// membership (§5.4), offline-queueable idempotent sends (§1.7/§3.6), minor-safe
// DMs (D-M6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string, cellA: string, cellB: string;
let aId: string, aTok: string; // cellA
let a2Id: string, a2Tok: string; // cellA (same cell as a)
let bTok: string; // cellB
let leaderTok: string; // Instructor in cellA
let minorId: string; // a minor in cellA

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
  aId = a.user_id; a2Id = a2.user_id; minorId = minor.user_id;
  aTok = bearer({ sub: a.user_id, role: "Student", cong });
  a2Tok = bearer({ sub: a2.user_id, role: "Student", cong });
  bTok = bearer({ sub: b.user_id, role: "Student", cong });
  leaderTok = bearer({ sub: l.user_id, role: "Instructor", cong });
});
afterAll(async () => {
  await closeTestPool();
});

async function groupId(tok: string): Promise<string> {
  const res = await agent().get("/v1/chat/conversations").set(auth(tok));
  const group = (res.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group");
  return group!.conversation_id;
}

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
});

// keep references used (lint)
void aId;
