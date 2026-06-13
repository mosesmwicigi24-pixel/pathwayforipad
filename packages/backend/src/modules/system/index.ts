// Module: system (Final Pathway Portal "System" section — reference data).
// Read endpoints for countries + languages, consumed by the Dashboard counts and
// the System admin pages (P4). Admin+. Full RBAC (roles, permissions, users)
// arrives in a later phase; this is the reference-data slice.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler } from "../../http/http.js";
import { many } from "../../db/db.js";

export const systemRouter: Router = Router();

export function registerSystem(ctx: AppContext): Router {
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const read = ctx.db.replica;
  const r = systemRouter;

  r.get("/admin/countries", ...adminOnly, handler(async (_req, res) => {
    const data = await many(
      read,
      `SELECT code, name, flag, region, subregion, dial_code, currency, status
         FROM countries ORDER BY name`,
    );
    res.json({ data });
  }));

  r.get("/admin/languages", ...adminOnly, handler(async (_req, res) => {
    const data = await many(
      read,
      `SELECT code, name, native_name, direction, is_default, coverage, status
         FROM languages ORDER BY is_default DESC, name`,
    );
    res.json({ data });
  }));

  return r;
}
