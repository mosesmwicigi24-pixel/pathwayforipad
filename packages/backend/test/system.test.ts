// System reference data (Final Pathway Portal "System" section): countries +
// languages read endpoints, Admin-gated. Reference rows come from the seed.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup } from "./helpers/factories.js";

let adminTok: string;
let studentTok: string;
let adminId: string;

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
  adminId = admin.user_id;
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

describe("congregations admin (System section)", () => {
  it("lists the existing congregation with counts (Admin)", async () => {
    const res = await agent().get("/v1/admin/congregations").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toMatchObject({ cell_count: expect.any(Number), member_count: expect.any(Number) });
  });

  it("creates, updates and rejects duplicate congregations (Admin)", async () => {
    const created = await agent().post("/v1/admin/congregations").set(auth(adminTok))
      .send({ name: "Nairobi East", country: "ke", timezone: "Africa/Nairobi" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Nairobi East", country: "KE", timezone: "Africa/Nairobi" });

    const dup = await agent().post("/v1/admin/congregations").set(auth(adminTok)).send({ name: "nairobi east", country: "KE" });
    expect(dup.status).toBe(409);

    const upd = await agent().put(`/v1/admin/congregations/${created.body.congregation_id}`).set(auth(adminTok))
      .send({ name: "Nairobi Central", timezone: "Africa/Kampala" });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: "Nairobi Central", timezone: "Africa/Kampala" });

    const missing = await agent().put("/v1/admin/congregations/00000000-0000-0000-0000-000000000000").set(auth(adminTok)).send({ name: "X" });
    expect(missing.status).toBe(404);
  });

  it("blocks deleting a congregation that still has cells, allows an empty one (Admin)", async () => {
    const empty = await agent().post("/v1/admin/congregations").set(auth(adminTok)).send({ name: "Spare Branch", country: "KE" });
    const withCells = await agent().post("/v1/admin/congregations").set(auth(adminTok)).send({ name: "Busy Branch", country: "KE" });
    await createCellGroup(withCells.body.congregation_id, "Cell A");

    const blocked = await agent().delete(`/v1/admin/congregations/${withCells.body.congregation_id}`).set(auth(adminTok));
    expect(blocked.status).toBe(422);

    const ok = await agent().delete(`/v1/admin/congregations/${empty.body.congregation_id}`).set(auth(adminTok));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ deleted: true });
  });

  it("denies congregation writes to non-admins (RBAC §5.4)", async () => {
    const res = await agent().post("/v1/admin/congregations").set(auth(studentTok)).send({ name: "X", country: "KE" });
    expect(res.status).toBe(403);
  });
});

describe("create system user — congregation fallback", () => {
  it("creates a portal user even when the admin's token carries no congregation", async () => {
    // SuperAdmins can be provisioned without a congregation → principal.congregationId
    // is "" (not a valid UUID). The handler must fall back to the first congregation.
    const noCongTok = bearer({ sub: adminId, role: "SuperAdmin", cong: "" });
    const res = await agent().post("/v1/admin/users").set(auth(noCongTok)).send({
      full_name: "New Staff", email: "new.staff@dev.local", password: "Sup3rSecret!", role_keys: ["system_admin"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ full_name: "New Staff", email: "new.staff@dev.local" });
  });
});
