// Growth content (Contract Matrix D5): devotionals, memory verses + mastery,
// reading plans + day progress, resources, mentor. Content is shared; progress
// is per-member and idempotent.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, me: string, meTok: string, mentor: string;
const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, role: "Instructor", email: "mentor@dev.local", fullName: "Pastor James" });
  me = a.user_id;
  mentor = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("devotional + resources (seeded content)", () => {
  it("serves today's devotional and the resource library", async () => {
    const dev = await agent().get("/v1/growth/devotional").set(auth(meTok));
    expect(dev.status).toBe(200);
    expect(dev.body.title).toBeTruthy();
    expect(dev.body.scripture_ref).toBeTruthy();

    const res = await agent().get("/v1/growth/resources").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("kind");
  });
});

describe("memory verses + mastery", () => {
  it("lists verses learning by default and masters at ≥90% match", async () => {
    const list = await agent().get("/v1/growth/memory-verses").set(auth(meTok));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((v: { status: string }) => v.status === "learning")).toBe(true);
    const id = list.body.data[0].memory_verse_id;

    // A weak attempt stays "learning"; a strong one masters; best is kept.
    await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 60 });
    const strong = await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 95 });
    expect(strong.body.status).toBe("mastered");

    const weakerReplay = await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 20 });
    expect(weakerReplay.body.status).toBe("mastered"); // best_match_pct kept; never demoted
    expect(weakerReplay.body.best_match_pct).toBe(95);

    const after = await agent().get("/v1/growth/memory-verses").set(auth(meTok));
    expect(after.body.data.find((v: { memory_verse_id: string }) => v.memory_verse_id === id).status).toBe("mastered");
  });
});

describe("reading plans + day progress", () => {
  it("starts a plan and advances current_day as days are completed", async () => {
    const plans = await agent().get("/v1/growth/plans").set(auth(meTok));
    expect(plans.status).toBe(200);
    const john = plans.body.data.find((p: { code: string }) => p.code === "gospel-of-john");
    expect(john.enrolled).toBe(false);

    const start = await agent().post(`/v1/growth/plans/${john.plan_id}/start`).set(auth(meTok));
    expect(start.status).toBe(201);
    expect(start.body.current_day).toBe(1);

    const detail = await agent().get(`/v1/growth/plans/${john.plan_id}`).set(auth(meTok));
    expect(detail.body.enrolled).toBe(true);
    expect(detail.body.days.length).toBeGreaterThan(0);
    expect(detail.body.days[0].reference).toBeTruthy();

    const d1 = await agent().post(`/v1/growth/plans/${john.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(d1.body.current_day).toBe(2);
    expect(d1.body.completed_days).toContain(1);

    // Idempotent re-complete: no duplicate day, no regression.
    const d1again = await agent().post(`/v1/growth/plans/${john.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(d1again.body.completed_days).toEqual([1]);
    expect(d1again.body.current_day).toBe(2);
  });
});

describe("mentor", () => {
  it("returns the discipler from the relationship tree + meeting notes", async () => {
    await testPool().query(`INSERT INTO relationship_tree (multiplier_id, disciple_id) VALUES ($1, $2)`, [mentor, me]);
    await testPool().query(
      `INSERT INTO mentor_notes (user_id, mentor_user_id, topic, note, met_at, next_meeting_at)
       VALUES ($1, $2, 'Renewing the mind', 'Worked through Romans 12.', now() - interval '7 days', now() + interval '3 days')`,
      [me, mentor],
    );
    const res = await agent().get("/v1/growth/mentor").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.mentor.full_name).toBe("Pastor James");
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].topic).toBe("Renewing the mind");
    expect(res.body.next_meeting_at).not.toBeNull();
  });

  it("returns null mentor when no discipler is assigned", async () => {
    const res = await agent().get("/v1/growth/mentor").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.mentor).toBeNull();
    expect(res.body.notes).toEqual([]);
  });
});
