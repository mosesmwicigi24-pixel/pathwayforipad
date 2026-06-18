// Module: system (Final Pathway Portal "System" section).
// Countries + languages reference CRUD, the RBAC roles/permission matrix, and
// portal-user (account) administration. Every route is gated by the fine-grained
// permission matrix via requirePermission (countries/languages/rolesAdmin/users),
// with the legacy SuperAdmin/Admin bridge (§5.4).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { many, one, maybeOne, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { hashPassword } from "../identity/passwords.js";

export const systemRouter: Router = Router();

// Fixed RBAC dimensions — mirrored in the web client (systemData). The matrix is
// module × capability; only granted cells are stored.
const PERM_MODULES = [
  "dashboard", "levels", "cms", "quiz", "videos", "cells", "members",
  "reflections", "events", "finance", "certificates", "badges",
  "users", "rolesAdmin", "countries", "languages", "congregations",
] as const;
const CAPABILITIES = ["view", "create", "edit", "delete", "approve", "export"] as const;

const RoleInput = z.object({
  name: z.string().min(1).max(120),
  role_type: z.enum(["system", "staff", "field"]).optional(),
  description: z.string().max(2000).optional(),
  copy_from: z.string().max(60).optional(),
});
const PermsInput = z.object({
  permissions: z.array(z.object({
    module_id: z.enum(PERM_MODULES),
    capability: z.enum(CAPABILITIES),
  })).max(PERM_MODULES.length * CAPABILITIES.length),
});

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const UserInput = z.object({
  full_name: z.string().min(1).max(255),
  email: z.string().email(),
  phone_number: z.string().max(32).optional(),
  password: z.string().min(8).max(200).optional(),
  country_code: z.string().length(2).nullable().optional(),
  locale: z.string().max(12).optional(),
  account_status: z.enum(["active", "invited", "suspended"]).optional(),
  require_2fa: z.boolean().optional(),
  role_keys: z.array(z.string().max(60)).optional(),
});

// Map assigned RBAC roles to the coarse legacy enum so the auth bridge and any
// not-yet-migrated requireRole endpoints stay coherent (§5.4, P3 migration).
function legacyRoleFor(roleKeys: string[]): "SuperAdmin" | "Admin" | "Instructor" {
  if (roleKeys.includes("super_admin")) return "SuperAdmin";
  if (roleKeys.includes("system_admin")) return "Admin";
  return "Instructor";
}

const CountryInput = z.object({
  code: z.string().length(2),
  name: z.string().min(1),
  flag: z.string().max(8).nullable().optional(),
  region: z.string().max(60).nullable().optional(),
  subregion: z.string().max(60).nullable().optional(),
  dial_code: z.string().max(8).nullable().optional(),
  currency: z.string().max(3).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
const LanguageInput = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1),
  native_name: z.string().min(1),
  direction: z.enum(["ltr", "rtl"]).optional(),
  is_default: z.boolean().optional(),
  coverage: z.number().int().min(0).max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const CongregationInput = z.object({
  name: z.string().min(1).max(255),
  country: z.string().length(2),
  timezone: z.string().min(1).max(64).optional(),
});

const COUNTRY_COLS = "code, name, flag, region, subregion, dial_code, currency, status";
const LANG_COLS = "code, name, native_name, direction, is_default, coverage, status";
const CONG_COLS = "congregation_id, name, country, timezone, created_at";

export function registerSystem(ctx: AppContext): Router {
  const auth = authenticate(ctx.env);
  const read = ctx.db.replica;
  const db = ctx.db.primary;
  const r = systemRouter;
  // Fine-grained gate for the RBAC admin surface (legacy Admin/SuperAdmin bridge
  // keeps existing portal admins fully able; granular roles extend access).
  const perm = requirePermission(read);
  const canViewRoles = [auth, perm("rolesAdmin", "view")] as const;

  // ── Countries ──
  r.get("/admin/countries", auth, perm("countries", "view"), handler(async (_req, res) => {
    res.json({ data: await many(read, `SELECT ${COUNTRY_COLS} FROM countries ORDER BY name`) });
  }));

  r.post("/admin/countries", auth, perm("countries", "create"), handler(async (req, res) => {
    const input = parseBody(CountryInput, req.body);
    const code = input.code.toUpperCase();
    const row = await tx(db, async (c) => {
      const exists = await maybeOne(c, `SELECT 1 FROM countries WHERE code = $1`, [code]);
      if (exists) throw new ApiError("CONFLICT", "Country code already exists");
      const created = await one(c, `INSERT INTO countries (code, name, flag, region, subregion, dial_code, currency, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'active')) RETURNING ${COUNTRY_COLS}`,
        [code, input.name, input.flag ?? null, input.region ?? null, input.subregion ?? null, input.dial_code ?? null, input.currency ?? null, input.status ?? null]);
      await audit(c, requirePrincipal(req).userId, "country.created", "countries", code, {});
      return created;
    });
    res.status(201).json(row);
  }));

  r.put("/admin/countries/:code", auth, perm("countries", "edit"), handler(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const input = parseBody(CountryInput.partial().omit({ code: true }), req.body);
    const cols: Record<string, unknown> = { name: input.name, flag: input.flag, region: input.region, subregion: input.subregion, dial_code: input.dial_code, currency: input.currency, status: input.status };
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    const row = await tx(db, async (c) => {
      const existing = await maybeOne(c, `SELECT 1 FROM countries WHERE code = $1`, [code]);
      if (!existing) throw new ApiError("NOT_FOUND", "Country not found");
      if (keys.length) await c.query(`UPDATE countries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE code = $1`, [code, ...keys.map((k) => cols[k])]);
      await audit(c, requirePrincipal(req).userId, "country.updated", "countries", code, { fields: keys });
      return one(c, `SELECT ${COUNTRY_COLS} FROM countries WHERE code = $1`, [code]);
    });
    res.json(row);
  }));

  // ── Languages ──
  r.get("/admin/languages", auth, perm("languages", "view"), handler(async (_req, res) => {
    res.json({ data: await many(read, `SELECT ${LANG_COLS} FROM languages ORDER BY is_default DESC, name`) });
  }));

  r.post("/admin/languages", auth, perm("languages", "create"), handler(async (req, res) => {
    const input = parseBody(LanguageInput, req.body);
    const code = input.code.toLowerCase();
    const row = await tx(db, async (c) => {
      const exists = await maybeOne(c, `SELECT 1 FROM languages WHERE code = $1`, [code]);
      if (exists) throw new ApiError("CONFLICT", "Language code already exists");
      if (input.is_default) await c.query(`UPDATE languages SET is_default = FALSE WHERE is_default`);
      const created = await one(c, `INSERT INTO languages (code, name, native_name, direction, is_default, coverage, status)
           VALUES ($1,$2,$3,COALESCE($4,'ltr'),COALESCE($5,FALSE),COALESCE($6,0),COALESCE($7,'active')) RETURNING ${LANG_COLS}`,
        [code, input.name, input.native_name, input.direction ?? null, input.is_default ?? null, input.coverage ?? null, input.status ?? null]);
      await audit(c, requirePrincipal(req).userId, "language.created", "languages", code, {});
      return created;
    });
    res.status(201).json(row);
  }));

  r.put("/admin/languages/:code", auth, perm("languages", "edit"), handler(async (req, res) => {
    const code = String(req.params.code).toLowerCase();
    const input = parseBody(LanguageInput.partial().omit({ code: true }), req.body);
    const row = await tx(db, async (c) => {
      const existing = await maybeOne(c, `SELECT 1 FROM languages WHERE code = $1`, [code]);
      if (!existing) throw new ApiError("NOT_FOUND", "Language not found");
      if (input.is_default === true) await c.query(`UPDATE languages SET is_default = FALSE WHERE is_default AND code <> $1`, [code]);
      const cols: Record<string, unknown> = { name: input.name, native_name: input.native_name, direction: input.direction, is_default: input.is_default, coverage: input.coverage, status: input.status };
      const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
      if (keys.length) await c.query(`UPDATE languages SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE code = $1`, [code, ...keys.map((k) => cols[k])]);
      await audit(c, requirePrincipal(req).userId, "language.updated", "languages", code, { fields: keys });
      return one(c, `SELECT ${LANG_COLS} FROM languages WHERE code = $1`, [code]);
    });
    res.json(row);
  }));

  r.delete("/admin/languages/:code", auth, perm("languages", "delete"), handler(async (req, res) => {
    const code = String(req.params.code).toLowerCase();
    await tx(db, async (c) => {
      const lang = await maybeOne<{ is_default: boolean }>(c, `SELECT is_default FROM languages WHERE code = $1`, [code]);
      if (!lang) throw new ApiError("NOT_FOUND", "Language not found");
      if (lang.is_default) throw new ApiError("UNPROCESSABLE", "The default language cannot be removed");
      await c.query(`DELETE FROM languages WHERE code = $1`, [code]);
      await audit(c, requirePrincipal(req).userId, "language.deleted", "languages", code, {});
    });
    res.json({ deleted: true });
  }));

  // ── Congregations (branches/assemblies; every cell + user belongs to one) ──
  r.get("/admin/congregations", auth, perm("congregations", "view"), handler(async (_req, res) => {
    res.json({ data: await many(read,
      `SELECT ${CONG_COLS},
              (SELECT count(*)::int FROM cell_groups g WHERE g.congregation_id = c.congregation_id) AS cell_count,
              (SELECT count(*)::int FROM users u WHERE u.congregation_id = c.congregation_id AND u.deleted_at IS NULL) AS member_count
         FROM congregations c
        ORDER BY c.created_at`) });
  }));

  r.post("/admin/congregations", auth, perm("congregations", "create"), handler(async (req, res) => {
    const input = parseBody(CongregationInput, req.body);
    const country = input.country.toUpperCase();
    const row = await tx(db, async (c) => {
      const dup = await maybeOne(c, `SELECT 1 FROM congregations WHERE lower(name) = lower($1)`, [input.name]);
      if (dup) throw new ApiError("CONFLICT", "A congregation with that name already exists");
      const created = await one(c,
        `INSERT INTO congregations (name, country, timezone)
           VALUES ($1,$2,COALESCE($3,'Africa/Nairobi')) RETURNING ${CONG_COLS}`,
        [input.name, country, input.timezone ?? null]);
      await audit(c, requirePrincipal(req).userId, "congregation.created", "congregations", (created as { congregation_id: string }).congregation_id, {});
      return created;
    });
    res.status(201).json(row);
  }));

  r.put("/admin/congregations/:id", auth, perm("congregations", "edit"), handler(async (req, res) => {
    const id = String(req.params.id);
    const input = parseBody(CongregationInput.partial(), req.body);
    const cols: Record<string, unknown> = {
      name: input.name,
      country: input.country ? input.country.toUpperCase() : undefined,
      timezone: input.timezone,
    };
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    const row = await tx(db, async (c) => {
      if (!await maybeOne(c, `SELECT 1 FROM congregations WHERE congregation_id = $1`, [id])) {
        throw new ApiError("NOT_FOUND", "Congregation not found");
      }
      if (keys.length) await c.query(`UPDATE congregations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE congregation_id = $1`, [id, ...keys.map((k) => cols[k])]);
      await audit(c, requirePrincipal(req).userId, "congregation.updated", "congregations", id, { fields: keys });
      return one(c, `SELECT ${CONG_COLS} FROM congregations WHERE congregation_id = $1`, [id]);
    });
    res.json(row);
  }));

  r.delete("/admin/congregations/:id", auth, perm("congregations", "delete"), handler(async (req, res) => {
    const id = String(req.params.id);
    await tx(db, async (c) => {
      if (!await maybeOne(c, `SELECT 1 FROM congregations WHERE congregation_id = $1`, [id])) {
        throw new ApiError("NOT_FOUND", "Congregation not found");
      }
      const cells = await maybeOne(c, `SELECT 1 FROM cell_groups WHERE congregation_id = $1 LIMIT 1`, [id]);
      if (cells) throw new ApiError("UNPROCESSABLE", "This congregation still has cells; reassign or remove them first");
      const members = await maybeOne(c, `SELECT 1 FROM users WHERE congregation_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (members) throw new ApiError("UNPROCESSABLE", "This congregation still has members; reassign them first");
      await c.query(`DELETE FROM congregations WHERE congregation_id = $1`, [id]);
      await audit(c, requirePrincipal(req).userId, "congregation.deleted", "congregations", id, {});
    });
    res.json({ deleted: true });
  }));

  // ── Roles & Permissions (RBAC) ──
  r.get("/admin/roles", ...canViewRoles, handler(async (_req, res) => {
    const roles = await many<Record<string, unknown>>(read,
      `SELECT r.role_key, r.name, r.role_type, r.description, r.is_system, r.status,
              (SELECT count(*)::int FROM rbac_user_roles ur WHERE ur.role_key = r.role_key) AS user_count
         FROM rbac_roles r
        ORDER BY r.is_system DESC,
                 CASE r.role_type WHEN 'system' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END,
                 r.name`);
    const perms = await many<{ role_key: string; module_id: string; capability: string }>(read,
      `SELECT role_key, module_id, capability FROM rbac_role_permissions`);
    const byRole = new Map<string, Array<{ module_id: string; capability: string }>>();
    for (const p of perms) {
      const arr = byRole.get(p.role_key) ?? [];
      arr.push({ module_id: p.module_id, capability: p.capability });
      byRole.set(p.role_key, arr);
    }
    res.json({ data: roles.map((role) => ({ ...role, permissions: byRole.get(role.role_key as string) ?? [] })) });
  }));

  r.post("/admin/roles", auth, perm("rolesAdmin", "create"), handler(async (req, res) => {
    const input = parseBody(RoleInput, req.body);
    const key = slugify(input.name);
    if (!key) throw new ApiError("UNPROCESSABLE", "Role name must contain letters or numbers");
    const row = await tx(db, async (c) => {
      if (await maybeOne(c, `SELECT 1 FROM rbac_roles WHERE role_key = $1`, [key])) {
        throw new ApiError("CONFLICT", "A role with this name already exists");
      }
      const created = await one(c,
        `INSERT INTO rbac_roles (role_key, name, role_type, description, is_system)
           VALUES ($1,$2,COALESCE($3,'staff'),COALESCE($4,''),FALSE)
         RETURNING role_key, name, role_type, description, is_system, status`,
        [key, input.name, input.role_type ?? null, input.description ?? null]);
      if (input.copy_from) {
        await c.query(
          `INSERT INTO rbac_role_permissions (role_key, module_id, capability)
             SELECT $1, module_id, capability FROM rbac_role_permissions WHERE role_key = $2
           ON CONFLICT DO NOTHING`,
          [key, input.copy_from]);
      }
      await audit(c, requirePrincipal(req).userId, "role.created", "rbac_roles", key, { copy_from: input.copy_from ?? null });
      return created;
    });
    res.status(201).json(row);
  }));

  r.put("/admin/roles/:key", auth, perm("rolesAdmin", "edit"), handler(async (req, res) => {
    const key = String(req.params.key);
    const input = parseBody(RoleInput.partial().extend({ status: z.enum(["active", "inactive"]).optional() }), req.body);
    const cols: Record<string, unknown> = { name: input.name, description: input.description, status: input.status };
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    const row = await tx(db, async (c) => {
      if (!await maybeOne(c, `SELECT 1 FROM rbac_roles WHERE role_key = $1`, [key])) {
        throw new ApiError("NOT_FOUND", "Role not found");
      }
      if (keys.length) {
        await c.query(`UPDATE rbac_roles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE role_key = $1`,
          [key, ...keys.map((k) => cols[k])]);
      }
      await audit(c, requirePrincipal(req).userId, "role.updated", "rbac_roles", key, { fields: keys });
      return one(c, `SELECT role_key, name, role_type, description, is_system, status FROM rbac_roles WHERE role_key = $1`, [key]);
    });
    res.json(row);
  }));

  // Replace a role's permission matrix wholesale. super_admin is always full and
  // cannot be restricted.
  r.put("/admin/roles/:key/permissions", auth, perm("rolesAdmin", "edit"), handler(async (req, res) => {
    const key = String(req.params.key);
    const input = parseBody(PermsInput, req.body);
    if (key === "super_admin") throw new ApiError("UNPROCESSABLE", "Super Admin always has full access");
    await tx(db, async (c) => {
      if (!await maybeOne(c, `SELECT 1 FROM rbac_roles WHERE role_key = $1`, [key])) {
        throw new ApiError("NOT_FOUND", "Role not found");
      }
      await c.query(`DELETE FROM rbac_role_permissions WHERE role_key = $1`, [key]);
      for (const p of input.permissions) {
        await c.query(`INSERT INTO rbac_role_permissions (role_key, module_id, capability) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [key, p.module_id, p.capability]);
      }
      await audit(c, requirePrincipal(req).userId, "role.permissions_set", "rbac_roles", key, { count: input.permissions.length });
    });
    res.json({ role_key: key, count: input.permissions.length });
  }));

  r.delete("/admin/roles/:key", auth, perm("rolesAdmin", "delete"), handler(async (req, res) => {
    const key = String(req.params.key);
    await tx(db, async (c) => {
      const role = await maybeOne<{ is_system: boolean }>(c, `SELECT is_system FROM rbac_roles WHERE role_key = $1`, [key]);
      if (!role) throw new ApiError("NOT_FOUND", "Role not found");
      if (role.is_system) throw new ApiError("UNPROCESSABLE", "Built-in roles cannot be deleted");
      await c.query(`DELETE FROM rbac_roles WHERE role_key = $1`, [key]); // cascades perms + assignments
      await audit(c, requirePrincipal(req).userId, "role.deleted", "rbac_roles", key, {});
    });
    res.json({ deleted: true });
  }));

  // ── System users (portal accounts) ──
  const USER_SELECT = `
    SELECT u.user_id, u.full_name, u.email, u.phone_number, u.country_code, u.locale,
           u.account_status, u.require_2fa,
           (SELECT max(ie.occurred_at) FROM interaction_events ie WHERE ie.user_id = u.user_id) AS last_active,
           COALESCE(array_agg(ur.role_key) FILTER (WHERE ur.role_key IS NOT NULL), '{}') AS role_keys
      FROM users u
      LEFT JOIN rbac_user_roles ur ON ur.user_id = u.user_id`;

  r.get("/admin/users", auth, perm("users", "view"), handler(async (_req, res) => {
    const rows = await many<Record<string, unknown>>(read,
      `${USER_SELECT}
        WHERE u.deleted_at IS NULL AND (u.role <> 'Student' OR ur.role_key IS NOT NULL)
        GROUP BY u.user_id
        ORDER BY u.full_name`);
    res.json({ data: rows });
  }));

  r.post("/admin/users", auth, perm("users", "create"), handler(async (req, res) => {
    const input = parseBody(UserInput, req.body);
    if (!input.password) throw new ApiError("UNPROCESSABLE", "A password is required for a new account");
    const principal = requirePrincipal(req);
    const roleKeys = input.role_keys ?? [];
    const password_hash = await hashPassword(input.password);
    const row = await tx(db, async (c) => {
      if (await maybeOne(c, `SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL`, [input.email])) {
        throw new ApiError("CONFLICT", "A user with this email already exists");
      }
      // Portal accounts belong to a congregation. The principal's congregation can be
      // empty (e.g. a SuperAdmin provisioned without one) — an empty string is not a
      // valid UUID and would crash the insert, so fall back to the first congregation.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let congregationId = UUID_RE.test(principal.congregationId ?? "") ? principal.congregationId : null;
      if (!congregationId) {
        const first = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM congregations ORDER BY created_at LIMIT 1`);
        if (!first) throw new ApiError("VALIDATION_FAILED", "No congregation configured");
        congregationId = first.congregation_id;
      }
      const created = await one<{ user_id: string }>(c,
        `INSERT INTO users (full_name, email, password_hash, phone_number, date_of_birth, congregation_id,
                            role, country_code, locale, account_status, require_2fa)
           VALUES ($1,$2,$3,$4,'1990-01-01',$5,$6,$7,COALESCE($8,'en'),COALESCE($9,'active'),COALESCE($10,FALSE))
         RETURNING user_id`,
        [input.full_name, input.email, password_hash, input.phone_number ?? "", congregationId,
         legacyRoleFor(roleKeys), input.country_code ?? null, input.locale ?? null, input.account_status ?? null, input.require_2fa ?? null]);
      for (const rk of roleKeys) {
        await c.query(`INSERT INTO rbac_user_roles (user_id, role_key, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [created.user_id, rk, principal.userId]);
      }
      await audit(c, principal.userId, "user.created", "users", created.user_id, { roles: roleKeys });
      return one(c, `${USER_SELECT} WHERE u.user_id = $1 GROUP BY u.user_id`, [created.user_id]);
    });
    res.status(201).json(row);
  }));

  r.put("/admin/users/:id", auth, perm("users", "edit"), handler(async (req, res) => {
    const id = String(req.params.id);
    const input = parseBody(UserInput.partial().omit({ email: true }), req.body);
    const principal = requirePrincipal(req);
    const row = await tx(db, async (c) => {
      if (!await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [id])) {
        throw new ApiError("NOT_FOUND", "User not found");
      }
      const cols: Record<string, unknown> = {
        full_name: input.full_name, phone_number: input.phone_number,
        country_code: input.country_code, locale: input.locale,
        account_status: input.account_status, require_2fa: input.require_2fa,
      };
      if (input.password) cols.password_hash = await hashPassword(input.password);
      if (input.role_keys) cols.role = legacyRoleFor(input.role_keys);
      const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
      if (keys.length) {
        await c.query(`UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE user_id = $1`,
          [id, ...keys.map((k) => cols[k])]);
      }
      if (input.role_keys) {
        await c.query(`DELETE FROM rbac_user_roles WHERE user_id = $1`, [id]);
        for (const rk of input.role_keys) {
          await c.query(`INSERT INTO rbac_user_roles (user_id, role_key, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [id, rk, principal.userId]);
        }
      }
      await audit(c, principal.userId, "user.updated", "users", id, { fields: keys, roles_changed: !!input.role_keys });
      return one(c, `${USER_SELECT} WHERE u.user_id = $1 GROUP BY u.user_id`, [id]);
    });
    res.json(row);
  }));

  r.delete("/admin/users/:id", auth, perm("users", "delete"), handler(async (req, res) => {
    const id = String(req.params.id);
    const principal = requirePrincipal(req);
    if (id === principal.userId) throw new ApiError("UNPROCESSABLE", "You cannot delete your own account");
    await tx(db, async (c) => {
      const found = await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [id]);
      if (!found) throw new ApiError("NOT_FOUND", "User not found");
      await c.query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [id]);
      await audit(c, principal.userId, "user.deleted", "users", id, {});
    });
    res.json({ deleted: true });
  }));

  return r;
}
