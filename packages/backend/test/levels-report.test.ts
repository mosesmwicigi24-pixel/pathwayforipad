// Per-level curriculum analytics (GET /admin/reports/levels) for the Curriculum
// Levels page. Aggregates module counts, learners, completion, certificates +
// a 6-month enrolment trend. Admin-gated.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let adminTok: string;
let studentTok: string;

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  studentTok = bearer({ sub: student.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

const auth = (t: string) => ({ Authorization: t });

describe("levels report (§ Curriculum Levels)", () => {
  it("returns a row per seeded level with analytics fields + a trend array (Admin)", async () => {
    const res = await agent().get("/v1/admin/reports/levels").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.levels)).toBe(true);
    expect(res.body.levels.length).toBe(6); // 6 seeded levels
    const l1 = res.body.levels.find((l: { level_number: number }) => l.level_number === 1);
    expect(l1).toMatchObject({ level_number: 1 });
    expect(typeof l1.modules_total).toBe("number");
    expect(typeof l1.learners).toBe("number");
    expect(typeof l1.completion_pct).toBe("number");
    expect(l1.completion_pct).toBeGreaterThanOrEqual(0);
    expect(l1.completion_pct).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.trend)).toBe(true);
  });

  it("denies non-admins (RBAC §5.4)", async () => {
    const res = await agent().get("/v1/admin/reports/levels").set(auth(studentTok));
    expect(res.status).toBe(403);
  });
});
