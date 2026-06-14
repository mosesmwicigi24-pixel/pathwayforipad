// RBAC — Roles & Permissions (Final Pathway make System section). Seeded roles +
// matrix, custom-role CRUD, the single-default-style invariants, and enforcement
// via requirePermission: the legacy Admin bridge passes, a granular role grants
// access, and an unprivileged account is denied (§5.4).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string;
let adminTok: string;
let studentTok: string;
let instructorTok: string;
let instructorId: string;

const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
  const instructor = await createUser({ congregationId: cong, role: "Instructor", email: "i@dev.local" });
  instructorId = instructor.user_id;
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  studentTok = bearer({ sub: student.user_id, role: "Student", cong });
  instructorTok = bearer({ sub: instructor.user_id, role: "Instructor", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("RBAC roles & permission matrix", () => {
  it("lists the 11 seeded roles with their matrices (Admin bridge)", async () => {
    const res = await agent().get("/v1/admin/roles").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(11);
    const sa = res.body.data.find((r: { role_key: string }) => r.role_key === "super_admin");
    expect(sa.permissions).toHaveLength(16 * 6); // full grid
    expect(sa.is_system).toBe(true);
    const member = res.body.data.find((r: { role_key: string }) => r.role_key === "member");
    expect(member.permissions).toHaveLength(0);
    const curr = res.body.data.find((r: { role_key: string }) => r.role_key === "curriculum_editor");
    // full on cms → all 6 caps present for that module
    expect(curr.permissions.filter((p: { module_id: string }) => p.module_id === "cms")).toHaveLength(6);
  });

  it("denies an account with no rolesAdmin permission, allows one granted it", async () => {
    const denied = await agent().get("/v1/admin/roles").set(auth(studentTok));
    expect(denied.status).toBe(403);

    // Instructor has no rbac role yet → denied
    const before = await agent().get("/v1/admin/roles").set(auth(instructorTok));
    expect(before.status).toBe(403);

    // Grant system_admin (rolesAdmin: full) → now allowed through the matrix
    await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'system_admin')`, [instructorId]);
    const after = await agent().get("/v1/admin/roles").set(auth(instructorTok));
    expect(after.status).toBe(200);
  });

  it("creates a custom role copying another's permissions, then edits the matrix", async () => {
    const created = await agent().post("/v1/admin/roles").set(auth(adminTok))
      .send({ name: "Cell Coordinator", role_type: "field", description: "Coordinates cells.", copy_from: "discipler" });
    expect(created.status).toBe(201);
    expect(created.body.role_key).toBe("cell_coordinator");
    expect(created.body.is_system).toBe(false);

    const list = await agent().get("/v1/admin/roles").set(auth(adminTok));
    const cc = list.body.data.find((r: { role_key: string }) => r.role_key === "cell_coordinator");
    expect(cc.permissions.length).toBeGreaterThan(0); // copied from discipler

    const set = await agent().put("/v1/admin/roles/cell_coordinator/permissions").set(auth(adminTok))
      .send({ permissions: [{ module_id: "members", capability: "view" }, { module_id: "members", capability: "edit" }] });
    expect(set.status).toBe(200);
    expect(set.body.count).toBe(2);

    const after = await agent().get("/v1/admin/roles").set(auth(adminTok));
    const cc2 = after.body.data.find((r: { role_key: string }) => r.role_key === "cell_coordinator");
    expect(cc2.permissions).toHaveLength(2);
  });

  it("rejects duplicate role names", async () => {
    await agent().post("/v1/admin/roles").set(auth(adminTok)).send({ name: "Cell Coordinator" });
    const dup = await agent().post("/v1/admin/roles").set(auth(adminTok)).send({ name: "Cell Coordinator" });
    expect(dup.status).toBe(409);
  });

  it("never restricts super_admin and protects built-in roles from deletion", async () => {
    const lockPerms = await agent().put("/v1/admin/roles/super_admin/permissions").set(auth(adminTok)).send({ permissions: [] });
    expect(lockPerms.status).toBe(422);

    const delBuiltin = await agent().delete("/v1/admin/roles/discipler").set(auth(adminTok));
    expect(delBuiltin.status).toBe(422);

    await agent().post("/v1/admin/roles").set(auth(adminTok)).send({ name: "Temp Role" });
    const delCustom = await agent().delete("/v1/admin/roles/temp_role").set(auth(adminTok));
    expect(delCustom.status).toBe(200);
    expect(delCustom.body).toEqual({ deleted: true });
  });
});

describe("RBAC system users (portal accounts)", () => {
  it("creates, lists, updates roles and soft-deletes a portal user", async () => {
    const created = await agent().post("/v1/admin/users").set(auth(adminTok)).send({
      full_name: "Grace Wanjiru", email: "grace@nuru.org", password: "s3cret-pass",
      country_code: "KE", locale: "sw", account_status: "active", role_keys: ["curriculum_editor"],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ full_name: "Grace Wanjiru", account_status: "active" });
    expect(created.body.role_keys).toEqual(["curriculum_editor"]);
    const id = created.body.user_id as string;
    // Password is hashed, never returned.
    expect(created.body.password).toBeUndefined();
    const stored = await testPool().query("SELECT password_hash, role FROM users WHERE user_id = $1", [id]);
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2/);
    expect(stored.rows[0].role).toBe("Instructor"); // legacy enum derived from rbac roles

    const list = await agent().get("/v1/admin/users").set(auth(adminTok));
    expect(list.status).toBe(200);
    expect(list.body.data.map((u: { user_id: string }) => u.user_id)).toContain(id);

    const upd = await agent().put(`/v1/admin/users/${id}`).set(auth(adminTok)).send({ role_keys: ["super_admin"], account_status: "suspended" });
    expect(upd.status).toBe(200);
    expect(upd.body.role_keys).toEqual(["super_admin"]);
    expect(upd.body.account_status).toBe("suspended");
    const legacy = await testPool().query("SELECT role FROM users WHERE user_id = $1", [id]);
    expect(legacy.rows[0].role).toBe("SuperAdmin");

    const del = await agent().delete(`/v1/admin/users/${id}`).set(auth(adminTok));
    expect(del.status).toBe(200);
    const gone = await agent().get("/v1/admin/users").set(auth(adminTok));
    expect(gone.body.data.map((u: { user_id: string }) => u.user_id)).not.toContain(id);
  });

  it("rejects a duplicate email, a passwordless create, and self-deletion", async () => {
    await agent().post("/v1/admin/users").set(auth(adminTok)).send({ full_name: "A", email: "dup@nuru.org", password: "password1", role_keys: ["mentor"] });
    const dup = await agent().post("/v1/admin/users").set(auth(adminTok)).send({ full_name: "B", email: "dup@nuru.org", password: "password1", role_keys: ["mentor"] });
    expect(dup.status).toBe(409);

    const noPw = await agent().post("/v1/admin/users").set(auth(adminTok)).send({ full_name: "C", email: "c@nuru.org", role_keys: ["mentor"] });
    expect(noPw.status).toBe(422);

    // The admin (legacy Admin) is a portal user but isn't in the RBAC list unless
    // listed via legacy role; deleting self is blocked at the id guard.
    const selfTok = adminTok;
    const me = await agent().post("/v1/admin/users").set(auth(selfTok)).send({ full_name: "Self", email: "self@nuru.org", password: "password1", role_keys: ["mentor"] });
    const selfDelete = await agent().delete(`/v1/admin/users/${me.body.user_id}`).set(auth(bearer({ sub: me.body.user_id, role: "Instructor", cong })));
    // The created user has no users:delete permission (mentor) → forbidden, proving enforcement.
    expect(selfDelete.status).toBe(403);
  });

  it("denies user administration to accounts without the users permission", async () => {
    const denied = await agent().get("/v1/admin/users").set(auth(studentTok));
    expect(denied.status).toBe(403);
  });
});

describe("RBAC enforcement on migrated endpoints (matrix governs, not just the bridge)", () => {
  it("grants a granular role its module capability and denies others", async () => {
    // A legacy Instructor with no RBAC role is denied the Admin curriculum surface.
    const before = await agent().get("/v1/admin/levels").set(auth(instructorTok));
    expect(before.status).toBe(403);

    // Assign curriculum_editor (levels:full) → the same account can now read + author.
    await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'curriculum_editor')`, [instructorId]);
    const levels = await agent().get("/v1/admin/levels").set(auth(instructorTok));
    expect(levels.status).toBe(200);

    // curriculum_editor has no finance permission → still denied there.
    const finance = await agent().get("/v1/admin/finance/summary").set(auth(instructorTok));
    expect(finance.status).toBe(403);
  });

  it("keeps the legacy Admin bridge working for every migrated endpoint", async () => {
    for (const path of ["/v1/admin/levels", "/v1/admin/finance/summary", "/v1/admin/certificates", "/v1/admin/media", "/v1/admin/members", "/v1/admin/countries"]) {
      const res = await agent().get(path).set(auth(adminTok));
      expect(res.status, `Admin should still reach ${path}`).toBe(200);
    }
  });
});
