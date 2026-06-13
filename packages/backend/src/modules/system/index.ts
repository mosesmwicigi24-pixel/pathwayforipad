// Module: system (Final Pathway Portal "System" section — reference data).
// Countries + languages: read for the dashboard counts and the System admin pages,
// plus admin CRUD (create / update / language default + delete). Admin+. Full RBAC
// (roles, permissions, users) arrives in a later phase; this is the reference slice.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { many, one, maybeOne, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export const systemRouter: Router = Router();

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

const COUNTRY_COLS = "code, name, flag, region, subregion, dial_code, currency, status";
const LANG_COLS = "code, name, native_name, direction, is_default, coverage, status";

export function registerSystem(ctx: AppContext): Router {
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const read = ctx.db.replica;
  const db = ctx.db.primary;
  const r = systemRouter;

  // ── Countries ──
  r.get("/admin/countries", ...adminOnly, handler(async (_req, res) => {
    res.json({ data: await many(read, `SELECT ${COUNTRY_COLS} FROM countries ORDER BY name`) });
  }));

  r.post("/admin/countries", ...adminOnly, handler(async (req, res) => {
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

  r.put("/admin/countries/:code", ...adminOnly, handler(async (req, res) => {
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
  r.get("/admin/languages", ...adminOnly, handler(async (_req, res) => {
    res.json({ data: await many(read, `SELECT ${LANG_COLS} FROM languages ORDER BY is_default DESC, name`) });
  }));

  r.post("/admin/languages", ...adminOnly, handler(async (req, res) => {
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

  r.put("/admin/languages/:code", ...adminOnly, handler(async (req, res) => {
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

  r.delete("/admin/languages/:code", ...adminOnly, handler(async (req, res) => {
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

  return r;
}
