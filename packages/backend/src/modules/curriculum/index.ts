// Module: curriculum (spec §1.5)
// Owns: Levels, modules, lesson content, question banks, pass marks, curriculum
// versioning. Endpoints per §3.3 (curriculum & content).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CurriculumService } from "./service.js";
import { ScriptureService, buildScriptureProvider } from "./scripture.js";

export const curriculumRouter: Router = Router();

export function registerCurriculum(ctx: AppContext): Router {
  const svc = new CurriculumService(ctx.db.primary);
  const scripture = new ScriptureService(buildScriptureProvider(ctx.env), ctx.env.YOUVERSION_LANGUAGE_RANGES);
  const auth = authenticate(ctx.env);
  const r = curriculumRouter;

  r.get(
    "/levels",
    auth,
    handler(async (_req, res) => {
      res.json({ data: await svc.listLevels() });
    }),
  );

  r.get(
    "/levels/:n/modules",
    auth,
    handler(async (req, res) => {
      const n = parseBody(z.coerce.number().int().min(1).max(5), req.params.n);
      res.json({ data: await svc.listModulesForLevel(requirePrincipal(req).userId, n) });
    }),
  );

  r.get(
    "/modules/:id",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getModule(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Sanitised YouVersion passage by ref + version + language (§3.3).
  r.get(
    "/scripture",
    auth,
    handler(async (req, res) => {
      const q = parseBody(
        z.object({ ref: z.string().min(1), version: z.string().optional(), language: z.string().optional() }),
        req.query,
      );
      res.json(await scripture.passage(q.ref, q.version, q.language));
    }),
  );

  // --- Admin curriculum editing (RBAC: Admin+) ---
  r.put(
    "/admin/modules/:id",
    auth,
    requireRole("Admin"),
    handler(async (req, res) => {
      const input = parseBody(CurriculumService.EditModuleSchema, req.body);
      res.json(await svc.editModule(req.params.id ?? "", requirePrincipal(req).userId, input));
    }),
  );

  r.post(
    "/admin/modules/:id/questions",
    auth,
    requireRole("Admin"),
    handler(async (req, res) => {
      const input = parseBody(CurriculumService.AddQuestionsSchema, req.body);
      res.json(await svc.addQuestions(req.params.id ?? "", requirePrincipal(req).userId, input));
    }),
  );

  return r;
}
