// Prayer Wall: public, congregation-scoped requests with 🙏/emoji reactions and
// comments. Opt-in (separate from the private journal); scope never leaks across
// congregations.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, meId: string, meTok: string, otherTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const me = await createUser({ congregationId: cong, email: "me@dev.local", fullName: "Ada" });
  const friend = await createUser({ congregationId: cong, email: "f@dev.local", fullName: "Ben" });
  meId = me.user_id;
  meTok = bearer({ sub: me.user_id, role: "Student", cong });
  otherTok = bearer({ sub: friend.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("Prayer Wall", () => {
  it("posts, lists, prays, and comments", async () => {
    const post = await agent().post("/v1/prayer-wall").set(auth(meTok)).send({ post_id: uuid(1), title: "Exams", body: "Please pray for my finals." });
    expect(post.status).toBe(201);

    const list = await agent().get("/v1/prayer-wall").set(auth(otherTok));
    expect(list.status).toBe(200);
    const mine = (list.body.data as Array<{ post_id: string; author_name: string; pray_count: number }>).find((p) => p.post_id === uuid(1));
    expect(mine).toBeTruthy();
    expect(mine!.author_name).toBe("Ada");
    expect(mine!.pray_count).toBe(0);

    // a friend prays (🙏)
    const r = await agent().post(`/v1/prayer-wall/${uuid(1)}/reactions`).set(auth(otherTok)).send({ emoji: "🙏" });
    expect(r.body.on).toBe(true);
    // and comments
    await agent().post(`/v1/prayer-wall/${uuid(1)}/comments`).set(auth(otherTok)).send({ comment_id: uuid(2), body: "Praying with you 🙏" });

    const detail = await agent().get(`/v1/prayer-wall/${uuid(1)}`).set(auth(meTok));
    expect(detail.body.post.pray_count).toBe(1);
    expect((detail.body.comments as unknown[]).length).toBe(1);

    const list2 = await agent().get("/v1/prayer-wall").set(auth(meTok));
    const p2 = (list2.body.data as Array<{ post_id: string; pray_count: number; comment_count: number; i_prayed: boolean }>).find((p) => p.post_id === uuid(1))!;
    expect(p2.pray_count).toBe(1);
    expect(p2.comment_count).toBe(1);
  });

  it("persists a voice note's audio url + waveform on posts and comments", async () => {
    const audio = "https://res.cloudinary.com/demo/video/upload/voice.m4a";
    const wave = [5, 40, 90, 20, 70, 12];
    const post = await agent().post("/v1/prayer-wall").set(auth(meTok)).send({ post_id: uuid(8), body: "🎤 Voice prayer", audio_url: audio, audio_waveform: wave });
    expect(post.status).toBe(201);
    await agent().post(`/v1/prayer-wall/${uuid(8)}/comments`).set(auth(otherTok)).send({ comment_id: uuid(9), body: "🎤 Voice note", audio_url: audio, audio_waveform: [10, 30, 50] });

    const detail = await agent().get(`/v1/prayer-wall/${uuid(8)}`).set(auth(meTok));
    expect(detail.body.post.audio_url).toBe(audio);
    expect(detail.body.post.audio_waveform).toEqual(wave);
    expect(detail.body.comments[0].audio_url).toBe(audio);
    expect(detail.body.comments[0].audio_waveform).toEqual([10, 30, 50]);

    const list = await agent().get("/v1/prayer-wall").set(auth(meTok));
    const p = (list.body.data as Array<{ post_id: string; audio_waveform: number[] | null }>).find((x) => x.post_id === uuid(8))!;
    expect(p.audio_waveform).toEqual(wave);
  });

  it("shares a private journal prayer to the wall", async () => {
    await agent().put("/v1/me/prayers").set(auth(meTok)).send({ entry_id: uuid(3), body: "A quiet burden." });
    const shared = await agent().post(`/v1/me/prayers/${uuid(3)}/share-to-wall`).set(auth(meTok));
    expect(shared.status).toBe(201);
    expect(shared.body.post_id).toBeTruthy();

    const list = await agent().get("/v1/prayer-wall").set(auth(meTok));
    expect((list.body.data as Array<{ body: string }>).some((p) => p.body === "A quiet burden.")).toBe(true);
  });

  it("does not leak the wall across congregations", async () => {
    await agent().post("/v1/prayer-wall").set(auth(meTok)).send({ post_id: uuid(4), body: "Mine only." });
    const otherCong = await createCongregation("Other Branch");
    const o = await createUser({ congregationId: otherCong, email: "o@dev.local", fullName: "Outsider" });
    const oTok = bearer({ sub: o.user_id, role: "Student", cong: otherCong });
    const list = await agent().get("/v1/prayer-wall").set(auth(oTok));
    expect((list.body.data as Array<{ post_id: string }>).some((p) => p.post_id === uuid(4))).toBe(false);
    const denied = await agent().get(`/v1/prayer-wall/${uuid(4)}`).set(auth(oTok));
    expect(denied.status).toBe(404);
  });
});
