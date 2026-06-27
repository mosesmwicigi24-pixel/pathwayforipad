// Module: curriculum (spec §1.5)
// Owns: Levels, modules, lesson content, question banks, pass marks, curriculum
// versioning. Student read endpoints + the Admin authoring CMS (§3.3, §5.4).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CurriculumService } from "./service.js";
import { AdminCurriculumService } from "./admin.js";
import { ScriptureService, buildScriptureProvider } from "./scripture.js";
import { renderSafeMarkdown } from "./markdown.js";
import { cacheInvalidate, cacheKeys } from "../../cache.js";

export const curriculumRouter: Router = Router();

const levelParam = z.coerce.number().int().min(1);
const idOf = (req: { params: Record<string, string | undefined> }, k: string): string => req.params[k] ?? "";

export function registerCurriculum(ctx: AppContext): Router {
  const svc = new CurriculumService(ctx.db.primary, ctx.redis);
  const admin = new AdminCurriculumService(ctx.db.primary);
  const scripture = new ScriptureService(buildScriptureProvider(ctx.env), ctx.env.YOUVERSION_LANGUAGE_RANGES, ctx.redis);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica); // RBAC: curriculum modules levels/cms/quiz (§5.4)
  const r = curriculumRouter;

  // Bust the read-through caches whenever the catalog or a lesson body changes.
  const bust = (moduleId?: string): Promise<void> =>
    cacheInvalidate(ctx.redis, cacheKeys.levels, ...(moduleId ? [cacheKeys.moduleContent(moduleId)] : []));

  // ---------- Student / member reads (gated) ----------
  r.get(
    "/levels",
    auth,
    handler(async (_req, res) => {
      res.json({ data: await svc.listLevels() });
    }),
  );

  // Per-member pathway summary (level grid + completion). Not cached: per-user.
  r.get(
    "/me/pathway",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getPathwaySummary(requirePrincipal(req).userId));
    }),
  );

  r.get(
    "/levels/:n/modules",
    auth,
    handler(async (req, res) => {
      const n = parseBody(levelParam, req.params.n);
      res.json({ data: await svc.listModulesForLevel(requirePrincipal(req).userId, n) });
    }),
  );

  r.get(
    "/modules/:id",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getModule(requirePrincipal(req).userId, idOf(req, "id")));
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
      // Scripture is public, immutable content — let any edge/CDN (e.g. Cloudflare)
      // cache it for a day; the server-side Redis cache backs this regardless.
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json(await scripture.passage(q.ref, q.version, q.language));
    }),
  );

  // =================================================================
  // Admin curriculum CMS (RBAC: Admin/SuperAdmin only, §5.4)
  // =================================================================

  // ---- Levels ----
  r.get("/admin/levels", auth, perm("levels", "view"), handler(async (_req, res) => {
    res.json({ data: await admin.listLevels() });
  }));

  r.post("/admin/levels", auth, perm("levels", "create"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.CreateLevel, req.body);
    res.status(201).json(await admin.createLevel(requirePrincipal(req).userId, input));
  }));

  r.put("/admin/levels/:n", auth, perm("levels", "edit"), handler(async (req, res) => {
    const n = parseBody(levelParam, req.params.n);
    const input = parseBody(AdminCurriculumService.UpdateLevel, req.body);
    const out = await admin.updateLevel(n, requirePrincipal(req).userId, input);
    await bust();
    res.json(out);
  }));

  r.put("/admin/levels/:n/exam", auth, perm("levels", "edit"), handler(async (req, res) => {
    const n = parseBody(levelParam, req.params.n);
    const input = parseBody(AdminCurriculumService.UpdateExam, req.body);
    res.json(await admin.updateLevelExam(n, requirePrincipal(req).userId, input));
  }));

  r.get("/admin/levels/:n/modules", auth, perm("cms", "view"), handler(async (req, res) => {
    const n = parseBody(levelParam, req.params.n);
    res.json({ data: await admin.listModulesForLevel(n) });
  }));

  // ---- Modules ----
  r.post("/admin/modules", auth, perm("cms", "create"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.CreateModule, req.body);
    const out = await admin.createModule(requirePrincipal(req).userId, input);
    await bust();
    res.status(201).json(out);
  }));

  r.get("/admin/modules/:id", auth, perm("cms", "view"), handler(async (req, res) => {
    res.json(await admin.getModule(idOf(req, "id")));
  }));

  r.put("/admin/modules/:id", auth, perm("cms", "edit"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.UpdateModule, req.body);
    const out = await admin.updateModule(idOf(req, "id"), requirePrincipal(req).userId, input);
    await bust(idOf(req, "id"));
    res.json(out);
  }));

  r.post("/admin/modules/:id/publish", auth, perm("cms", "approve"), handler(async (req, res) => {
    const out = await admin.publish(idOf(req, "id"), requirePrincipal(req).userId);
    await bust(idOf(req, "id"));
    res.json(out);
  }));

  r.post("/admin/modules/:id/unpublish", auth, perm("cms", "approve"), handler(async (req, res) => {
    const out = await admin.unpublish(idOf(req, "id"), requirePrincipal(req).userId);
    await bust(idOf(req, "id"));
    res.json(out);
  }));

  r.post("/admin/modules/:id/reorder", auth, perm("cms", "edit"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.Reorder, req.body);
    const out = await admin.reorder(idOf(req, "id"), requirePrincipal(req).userId, input.to_sequence);
    await bust(idOf(req, "id"));
    res.json({ data: out });
  }));

  r.delete("/admin/modules/:id", auth, perm("cms", "delete"), handler(async (req, res) => {
    const out = await admin.archive(idOf(req, "id"), requirePrincipal(req).userId);
    await bust(idOf(req, "id"));
    res.json(out);
  }));

  r.get("/admin/modules/:id/versions", auth, perm("cms", "view"), handler(async (req, res) => {
    res.json({ data: await admin.listVersions(idOf(req, "id")) });
  }));

  r.post("/admin/modules/:id/revert", auth, perm("cms", "edit"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.Revert, req.body);
    const out = await admin.revert(idOf(req, "id"), requirePrincipal(req).userId, input.version_number);
    await bust(idOf(req, "id"));
    res.json(out);
  }));

  // ---- Question bank ----
  r.get("/admin/modules/:id/questions", auth, perm("quiz", "view"), handler(async (req, res) => {
    res.json({ data: await admin.listQuestions(idOf(req, "id")) });
  }));

  r.post("/admin/modules/:id/questions", auth, perm("quiz", "create"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.AddQuestions, req.body);
    res.status(201).json(await admin.addQuestions(idOf(req, "id"), requirePrincipal(req).userId, input));
  }));

  r.put("/admin/questions/:qid", auth, perm("quiz", "edit"), handler(async (req, res) => {
    const input = parseBody(AdminCurriculumService.UpdateQuestion, req.body);
    res.json(await admin.updateQuestion(idOf(req, "qid"), requirePrincipal(req).userId, input));
  }));

  r.delete("/admin/questions/:qid", auth, perm("quiz", "delete"), handler(async (req, res) => {
    res.json(await admin.deleteQuestion(idOf(req, "qid"), requirePrincipal(req).userId));
  }));

  // ---- Authoring helper: sanitized Markdown preview (§5.8, Phase D) ----
  r.post("/admin/preview", auth, perm("cms", "view"), handler(async (req, res) => {
    const input = parseBody(z.object({ markdown: z.string() }), req.body);
    res.json({ html: renderSafeMarkdown(input.markdown) });
  }));

  return r;
}
