// Member growth scores (scores module). Every score reads the canonical activity
// ledger (interaction_events) which the domain write-paths now feed: a module
// completion, a logged prayer, etc. all surface in the right score + rhythm.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";

let cong: string, cell: string, meId: string, meTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  const me = await createUser({ congregationId: cong, cellGroupId: cell, email: "me@dev.local", fullName: "Ada" });
  meId = me.user_id;
  meTok = bearer({ sub: meId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("composite /me/scores", () => {
  it("returns an overall + all five sub-scores in 0–100", async () => {
    const res = await agent().get("/v1/me/scores").set(auth(meTok));
    expect(res.status).toBe(200);
    for (const k of ["overall", "habits", "curriculum", "attendance", "word", "prayer"]) {
      expect(res.body).toHaveProperty(k);
    }
    for (const k of ["habits", "curriculum", "attendance", "word", "prayer"]) {
      const s = res.body[k].score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(res.body.overall.band).toBeTruthy();
  });
});

describe("activity ledger feeds the scores", () => {
  it("completing a module lifts the curriculum score", async () => {
    await createEnrollment(meId, 1);
    const moduleId = await createModule(1, 1, { evaluationKind: "none", published: true });

    const cur0 = await agent().get("/v1/me/scores/curriculum").set(auth(meTok));
    expect(cur0.body.detail.modules_completed).toBe(0);

    const done = await agent().post(`/v1/modules/${moduleId}/complete`).set(auth(meTok)).send({ client_mutation_id: uuid(1) });
    expect(done.status).toBe(200);

    const cur = await agent().get("/v1/me/scores/curriculum").set(auth(meTok));
    expect(cur.body.detail.modules_completed).toBeGreaterThanOrEqual(1);
    expect(cur.body.score).toBeGreaterThan(0);
  });

  it("logging a prayer lifts the prayer score and ticks the prayer rhythm", async () => {
    const before = await agent().get("/v1/me/scores/prayer").set(auth(meTok));
    expect(before.body.score).toBe(0);

    await agent().put("/v1/me/prayers").set(auth(meTok)).send({ entry_id: uuid(2), body: "Lord, grow my faith." });

    const after = await agent().get("/v1/me/scores/prayer").set(auth(meTok));
    expect(after.body.detail.prayers_logged).toBe(1);
    expect(after.body.detail.prayer_days_14).toBeGreaterThanOrEqual(1);
    expect(after.body.score).toBeGreaterThan(0);

    const rhythm = await agent().get("/v1/me/rhythm/today").set(auth(meTok));
    expect(rhythm.body.prayer).toBe(true);
  });

  it("app-engagement 'attendance' days lift the attendance score (no event check-in needed)", async () => {
    const before = await agent().get("/v1/me/scores/attendance").set(auth(meTok));
    expect(before.body.score).toBe(0);
    expect(before.body.detail.present_days_30d).toBe(0);

    // Two distinct app-present days (the mobile logs an 'attendance' interaction
    // when a member spends >=5 min in-app + does activity).
    const { testPool } = await import("./helpers/db.js");
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id) VALUES
         ($1, 'attendance', now() - interval '1 day',  gen_random_uuid()),
         ($1, 'attendance', now() - interval '3 days',  gen_random_uuid())`,
      [meId],
    );

    const after = await agent().get("/v1/me/scores/attendance").set(auth(meTok));
    expect(after.body.detail.present_days_30d).toBe(2);
    expect(after.body.detail.target).toBe(12);
    expect(after.body.score).toBe(Math.round((100 * 2) / 12)); // 17
    expect(after.body.score).toBeGreaterThan(0);
  });
});
