// Nuru assistant proxy (mobile NuruAssistant). Tests run against the offline
// FakeAiProvider (no GEMINI_API_KEY in the suite). Verifies the endpoint replies,
// and that grounding is privacy-safe: Nuru only sees a conversation the member
// can actually access (§5.4) — otherwise 404.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string, cellA: string, cellB: string;
let aTok: string, bTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a@dev.local", fullName: "Ada" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "b@dev.local", fullName: "Cara" });
  aTok = bearer({ sub: a.user_id, role: "Student", cong });
  bTok = bearer({ sub: b.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("Nuru assistant", () => {
  it("replies to a prompt (offline fake provider)", async () => {
    const res = await agent().post("/v1/assistant/chat").set(auth(aTok))
      .send({ messages: [{ role: "user", text: "Draft an encouragement for my friend" }] });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it("can ground on a conversation the member belongs to", async () => {
    // 'a' has a group room; seed a message so there's a transcript.
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const g = (list.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(1), body: "Please pray for my exams" });

    const res = await agent().post("/v1/assistant/chat").set(auth(aTok))
      .send({ messages: [{ role: "user", text: "Summarize my cohort" }], conversation_id: g });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it("refuses to ground on a conversation outside the member's scope (404, no leak)", async () => {
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const gA = (list.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;
    // 'b' (different cell) cannot ground Nuru on cell A's room.
    const res = await agent().post("/v1/assistant/chat").set(auth(bTok))
      .send({ messages: [{ role: "user", text: "What did they say?" }], conversation_id: gA });
    expect(res.status).toBe(404);
  });

  it("rejects an empty message list", async () => {
    const res = await agent().post("/v1/assistant/chat").set(auth(aTok)).send({ messages: [] });
    expect([400, 422]).toContain(res.status);
  });
});
