// Home feed — Next-Best-Action engine. Server-driven: returns the single highest
// priority prompt for the member, computed from their real signals.
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

describe("GET /me/home/next-action", () => {
  it("points a brand-new member at their first step", async () => {
    await createEnrollment(meId, 1);
    const moduleId = await createModule(1, 1, { evaluationKind: "none", published: true });

    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    const a = res.body.action;
    expect(a).toBeTruthy();
    expect(a.id).toBe("start");
    expect(a.route).toBe("module");
    expect(a.params.moduleId).toBe(moduleId);
    expect(a.cta_label).toBeTruthy();
  });

  it("always returns a hero (affirmation fallback) even with no enrollment", async () => {
    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.action).toBeTruthy();
    expect(typeof res.body.action.title).toBe("string");
    expect(["pathway", "module", "prayer", "memoryVerses", "devotional", "events", "none"]).toContain(res.body.action.route);
  });

  it("returns a personal daily greeting and caches it for the day", async () => {
    const res = await agent().get("/v1/me/home/greeting").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(typeof res.body.greeting).toBe("string");
    expect(res.body.greeting.length).toBeGreaterThan(0);
    // second call returns the same cached line
    const res2 = await agent().get("/v1/me/home/greeting").set(auth(meTok));
    expect(res2.body.greeting).toBe(res.body.greeting);
  });

  it("surfaces 'resume' once the member is underway", async () => {
    const enr = await createEnrollment(meId, 1);
    await createModule(1, 1, { evaluationKind: "none", published: true });
    const m2 = await createModule(1, 2, { evaluationKind: "none", published: true });
    // complete module 1 directly so modulesCompleted > 0 and m2 is the next
    const { testPool } = await import("./helpers/db.js");
    const m1 = await testPool().query<{ module_id: string }>(`SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=1`);
    await testPool().query(
      `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1,$2,TRUE,now())`,
      [enr, m1.rows[0]!.module_id],
    );
    void uuid;

    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.action.route).toBe("module");
    expect(res.body.action.params.moduleId).toBe(m2);
  });
});
