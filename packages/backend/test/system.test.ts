// System reference data (Final Pathway Portal "System" section): countries +
// languages read endpoints, Admin-gated. Reference rows come from the seed.
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

describe("system reference data (§ System section)", () => {
  it("lists seeded countries (Admin)", async () => {
    const res = await agent().get("/v1/admin/countries").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(8);
    const ke = res.body.data.find((c: { code: string }) => c.code === "KE");
    expect(ke).toMatchObject({ name: "Kenya", currency: "KES", status: "active" });
    expect(res.body.data.filter((c: { status: string }) => c.status === "active").length).toBe(7);
  });

  it("lists seeded languages with exactly one default (Admin)", async () => {
    const res = await agent().get("/v1/admin/languages").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
    const defaults = res.body.data.filter((l: { is_default: boolean }) => l.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe("en");
  });

  it("denies non-admins (RBAC §5.4)", async () => {
    const c = await agent().get("/v1/admin/countries").set(auth(studentTok));
    const l = await agent().get("/v1/admin/languages").set(auth(studentTok));
    expect(c.status).toBe(403);
    expect(l.status).toBe(403);
  });
});
