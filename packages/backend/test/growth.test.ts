// Growth domains (Contract Matrix B6): server-scored gifts assessment with
// serving-track suggestions, private prayer journal + verse library (offline
// sync: push ops, pull domains, tombstones), profile extensions + password change.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { hashPassword, verifyPassword } from "../src/modules/identity/passwords.js";

let cong: string, me: string, meTok: string, other: string, otherTok: string;

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, email: "other@dev.local" });
  me = a.user_id;
  other = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
  otherTok = bearer({ sub: other, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("spiritual gifts (personalized, server-scored, §1.1)", () => {
  it("serves a personalized 20-question set with baseline coverage of every gift", async () => {
    const r = await agent().get("/v1/gifts/questions").set(auth(meTok));
    expect(r.status).toBe(200);
    expect(typeof r.body.set_id).toBe("string");
    expect(r.body.ai_influenced).toBe(false); // no AI key in tests → deterministic
    expect(r.body.data.length).toBe(20); // bank is ~49; served subset is 20
    expect(r.body.data[0]).not.toHaveProperty("is_active"); // only member-safe fields
    // Every gift is represented (baseline coverage so each can score).
    const gifts = new Set(r.body.data.map((q: { gift_key: string }) => q.gift_key));
    expect(gifts.size).toBe(7);

    // The open set is reused across refetches (stable list).
    const again = await agent().get("/v1/gifts/questions").set(auth(meTok));
    expect(again.body.set_id).toBe(r.body.set_id);
  });

  it("scores over the SERVED subset and returns a personality result", async () => {
    const r = await agent().get("/v1/gifts/questions").set(auth(meTok));
    // Strongly agree on teaching, agree on mercy, low elsewhere — over the served set.
    const answers = r.body.data.map((q: { question_id: string; gift_key: string }) => ({
      question_id: q.question_id,
      value: q.gift_key === "teaching" ? 5 : q.gift_key === "mercy" ? 4 : 1,
    }));
    const res = await agent()
      .post("/v1/gifts/assessments")
      .set(auth(meTok))
      .send({ client_mutation_id: uuid(1), set_id: r.body.set_id, answers });
    expect(res.status).toBe(201);
    expect(res.body.scores.teaching).toBe(100);
    expect(res.body.scores.mercy).toBe(80);
    expect(res.body.scores.leadership).toBe(20);
    expect(res.body.top_gifts[0]).toBe("teaching");
    expect(typeof res.body.persona_summary).toBe("string"); // deterministic persona narrative

    // Replay is a no-op returning the original.
    const replay = await agent()
      .post("/v1/gifts/assessments")
      .set(auth(meTok))
      .send({ client_mutation_id: uuid(1), set_id: r.body.set_id, answers });
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.assessment_id).toBe(res.body.assessment_id);

    // Result reads as a personality: personas for the top gifts + serving tracks.
    const mine = await agent().get("/v1/me/gifts").set(auth(meTok));
    expect(mine.body.assessment.assessment_id).toBe(res.body.assessment_id);
    expect(mine.body.personas.length).toBe(res.body.top_gifts.length);
    expect(mine.body.personas[0].gift_key).toBe(res.body.top_gifts[0]);
    expect(mine.body.personas[0].persona_name.length).toBeGreaterThan(0);
    const tracks = mine.body.suggested_tracks.map((t: { track_key: string }) => t.track_key);
    expect(tracks).toContain("teaching_team");

    // Raw answers are persisted.
    const cnt = await testPool().query("SELECT count(*)::int AS n FROM gift_answers WHERE assessment_id = $1", [res.body.assessment_id]);
    expect(cnt.rows[0].n).toBe(answers.length);

    // After submitting, the next draw is a fresh set (the old one is consumed).
    const next = await agent().get("/v1/gifts/questions").set(auth(meTok));
    expect(next.body.set_id).not.toBe(r.body.set_id);
  });

  it("denominator is the served set, not the full bank (uniform answers → uniform %)", async () => {
    const r = await agent().get("/v1/gifts/questions").set(auth(meTok));
    const answers = r.body.data.map((q: { question_id: string }) => ({ question_id: q.question_id, value: 3 }));
    const res = await agent()
      .post("/v1/gifts/assessments")
      .set(auth(meTok))
      .send({ client_mutation_id: uuid(2), set_id: r.body.set_id, answers });
    expect(res.status).toBe(201);
    // 3 of 5 on every served question → 60% for every gift represented.
    for (const v of Object.values(res.body.scores as Record<string, number>)) expect(v).toBe(60);
  });

  it("rejects a submission against an unknown set", async () => {
    const res = await agent()
      .post("/v1/gifts/assessments")
      .set(auth(meTok))
      .send({ client_mutation_id: uuid(3), set_id: uuid(9), answers: [{ question_id: uuid(8), value: 5 }] });
    expect(res.status).toBe(404);
  });
});

describe("prayer journal (private, offline-synced)", () => {
  it("upserts with LWW, blocks cross-user writes, and hard-deletes with a tombstone", async () => {
    const entryId = uuid(10);
    const t1 = new Date("2026-06-01T10:00:00Z").toISOString();
    const t2 = new Date("2026-06-02T10:00:00Z").toISOString();

    const created = await agent()
      .put("/v1/me/prayers")
      .set(auth(meTok))
      .send({ entry_id: entryId, body: "Pray for my brother", updated_at: t1 });
    expect(created.status).toBe(200);

    // Newer write marks it answered…
    await agent()
      .put("/v1/me/prayers")
      .set(auth(meTok))
      .send({ entry_id: entryId, body: "Pray for my brother", is_answered: true, answered_note: "He came!", updated_at: t2 });
    // …and a STALE replay of the old state cannot un-answer it (LWW).
    const stale = await agent()
      .put("/v1/me/prayers")
      .set(auth(meTok))
      .send({ entry_id: entryId, body: "Pray for my brother", is_answered: false, updated_at: t1 });
    expect(stale.body.duplicate).toBe(true);

    const list = await agent().get("/v1/me/prayers").set(auth(meTok));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].is_answered).toBe(true);
    expect(list.body.data[0].answered_at).not.toBeNull();

    // Another member cannot write into my entry id.
    const foreign = await agent()
      .put("/v1/me/prayers")
      .set(auth(otherTok))
      .send({ entry_id: entryId, body: "hijack", updated_at: new Date().toISOString() });
    expect(foreign.status).toBe(403);
    // And never sees it in their pull (user-scoped domain, §5.4).
    const theirPull = await agent().post("/v1/sync/pull").set(auth(otherTok)).send({});
    expect(theirPull.body.changes.prayer_entries ?? []).toHaveLength(0);

    // My pull carries it; after delete, the next pull tombstones it.
    const pull1 = await agent().post("/v1/sync/pull").set(auth(meTok)).send({});
    expect(pull1.body.changes.prayer_entries.map((c: { row: { entry_id: string } }) => c.row.entry_id)).toContain(entryId);

    const del = await agent().delete(`/v1/me/prayers/${entryId}`).set(auth(meTok));
    expect(del.body.deleted).toBe(true);
    const reDel = await agent().delete(`/v1/me/prayers/${entryId}`).set(auth(meTok));
    expect(reDel.body.deleted).toBe(false); // idempotent

    const pull2 = await agent().post("/v1/sync/pull").set(auth(meTok)).send({ cursors: pull1.body.cursors });
    expect(pull2.body.tombstones.prayer_entries).toContain(entryId);
    const gone = await testPool().query(`SELECT 1 FROM prayer_entries WHERE entry_id=$1`, [entryId]);
    expect(gone.rowCount).toBe(0); // HARD delete — privacy
  });

  it("offline mutation queue replays prayers idempotently via /sync/push", async () => {
    const entryId = uuid(11);
    const mutations = [
      { mutation_id: uuid(20), seq: 1, domain: "prayer_entries", op: "upsert", payload: { entry_id: entryId, body: "From the queue" } },
      { mutation_id: uuid(20), seq: 2, domain: "prayer_entries", op: "upsert", payload: { entry_id: entryId, body: "From the queue" } },
    ];
    const push = await agent().post("/v1/sync/push").set(auth(meTok)).send({ mutations });
    expect(push.body.results[0].status).toBe("applied");
    expect(push.body.results[1].status).toBe("duplicate");

    const del = await agent()
      .post("/v1/sync/push")
      .set(auth(meTok))
      .send({ mutations: [{ mutation_id: uuid(21), seq: 3, domain: "prayer_entries", op: "delete", payload: { entry_id: entryId } }] });
    expect(del.body.results[0].status).toBe("applied");
  });
});

describe("verse library", () => {
  it("saves with per-translation dedup and deletes idempotently", async () => {
    const v1 = await agent()
      .put("/v1/me/verses")
      .set(auth(meTok))
      .send({ saved_verse_id: uuid(30), reference: "John 3:16", version: "KJV", note: "first" });
    expect(v1.status).toBe(200);

    // Saving the same verse+version again refreshes the note, no second row.
    await agent()
      .put("/v1/me/verses")
      .set(auth(meTok))
      .send({ saved_verse_id: uuid(31), reference: "John 3:16", version: "KJV", note: "updated" });
    const list = await agent().get("/v1/me/verses").set(auth(meTok));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].note).toBe("updated");
    expect(list.body.data[0].saved_verse_id).toBe(uuid(30)); // original row kept

    const del = await agent().delete(`/v1/me/verses/${uuid(30)}`).set(auth(meTok));
    expect(del.body.deleted).toBe(true);
    expect((await agent().get("/v1/me/verses").set(auth(meTok))).body.data).toHaveLength(0);
  });
});

describe("profile extensions + password change", () => {
  it("PATCH /me accepts gender/city/socials and GET /me returns them", async () => {
    const before = await agent().get("/v1/me").set(auth(meTok));
    const upd = await agent()
      .patch("/v1/me")
      .set(auth(meTok))
      .send({
        gender: "female",
        city: "Nairobi",
        socials: { instagram: "@grace", x: "@grace_w" },
        row_version: before.body.profile.row_version,
      });
    expect(upd.status).toBe(200);
    const after = await agent().get("/v1/me").set(auth(meTok));
    expect(after.body.profile.gender).toBe("female");
    expect(after.body.profile.city).toBe("Nairobi");
    expect(after.body.profile.socials.instagram).toBe("@grace");
    // role is still not writable (mass-assignment guard, §5.8)
    const evil = await agent()
      .patch("/v1/me")
      .set(auth(meTok))
      .send({ role: "Admin", row_version: after.body.profile.row_version });
    expect(evil.status).toBe(400);
  });

  it("changes the password only with the correct current one, revoking sessions", async () => {
    await testPool().query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [
      me,
      await hashPassword("old-secret-1"),
    ]);
    await testPool().query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, gen_random_uuid(), 'h', now() + interval '30 days')`,
      [me],
    );

    const wrong = await agent()
      .post("/v1/me/password")
      .set(auth(meTok))
      .send({ current_password: "nope", new_password: "new-secret-99" });
    expect(wrong.status).toBe(403);

    const ok = await agent()
      .post("/v1/me/password")
      .set(auth(meTok))
      .send({ current_password: "old-secret-1", new_password: "new-secret-99" });
    expect(ok.status).toBe(200);

    const row = await testPool().query(`SELECT password_hash FROM users WHERE user_id=$1`, [me]);
    expect(await verifyPassword(row.rows[0].password_hash, "new-secret-99")).toBe(true);
    const live = await testPool().query(
      `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL`,
      [me],
    );
    expect(live.rows[0].n).toBe(0); // every session family revoked

    // SSO-only accounts (no stored secret) are pointed at their provider.
    const sso = await agent()
      .post("/v1/me/password")
      .set(auth(otherTok))
      .send({ current_password: "x", new_password: "whatever-123" });
    expect(sso.status).toBe(422);
  });
});
