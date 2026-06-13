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

  it("creates, updates and rejects duplicate countries (Admin)", async () => {
    const created = await agent().post("/v1/admin/countries").set(auth(adminTok))
      .send({ code: "rw", name: "Rwanda", flag: "🇷🇼", region: "Africa", subregion: "Eastern Africa", dial_code: "+250", currency: "RWF" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "RW", name: "Rwanda", currency: "RWF", status: "active" });

    const dup = await agent().post("/v1/admin/countries").set(auth(adminTok)).send({ code: "RW", name: "Rwanda" });
    expect(dup.status).toBe(409);

    const upd = await agent().put("/v1/admin/countries/rw").set(auth(adminTok)).send({ status: "inactive", currency: "USD" });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ status: "inactive", currency: "USD" });

    const missing = await agent().put("/v1/admin/countries/zz").set(auth(adminTok)).send({ status: "inactive" });
    expect(missing.status).toBe(404);
  });

  it("creates a language and re-points the single default (Admin)", async () => {
    const created = await agent().post("/v1/admin/languages").set(auth(adminTok))
      .send({ code: "rw", name: "Kinyarwanda", native_name: "Ikinyarwanda", coverage: 80, is_default: true });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "rw", is_default: true });

    const list = await agent().get("/v1/admin/languages").set(auth(adminTok));
    const defaults = list.body.data.filter((l: { is_default: boolean }) => l.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe("rw");
  });

  it("blocks deleting the default language but allows others (Admin)", async () => {
    const blocked = await agent().delete("/v1/admin/languages/en").set(auth(adminTok));
    expect(blocked.status).toBe(422);

    const ok = await agent().delete("/v1/admin/languages/pt").set(auth(adminTok));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ deleted: true });
  });

  it("denies reference writes to non-admins (RBAC §5.4)", async () => {
    const c = await agent().post("/v1/admin/countries").set(auth(studentTok)).send({ code: "tz", name: "Tanzania" });
    const l = await agent().delete("/v1/admin/languages/en").set(auth(studentTok));
    expect(c.status).toBe(403);
    expect(l.status).toBe(403);
  });
});
