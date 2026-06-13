// Module: growth-content (Contract Matrix D5)
// Member-facing growth content + private progress: devotional, memory verses,
// reading plans, resources, mentor. All authenticated; content is shared,
// progress is the caller's own.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { GrowthContentService } from "./service.js";
import { AdminGrowthService } from "./admin.js";

const PlanIdParam = z.object({ id: z.string().uuid() });
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export const growthContentRouter: Router = Router();

export function registerGrowthContent(ctx: AppContext): Router {
  const svc = new GrowthContentService(ctx.db.primary);
  const adminSvc = new AdminGrowthService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = growthContentRouter;

  r.get("/growth/devotional", auth, handler(async (_req, res) => {
    res.json(await svc.todayDevotional());
  }));

  r.get("/growth/memory-verses", auth, handler(async (req, res) => {
    res.json(await svc.memoryVerses(requirePrincipal(req).userId));
  }));
  r.post("/growth/memory-verses/practice", auth, handler(async (req, res) => {
    const input = parseBody(GrowthContentService.Practice, req.body);
    res.json(await svc.practiceVerse(requirePrincipal(req).userId, input));
  }));

  r.get("/growth/plans", auth, handler(async (req, res) => {
    res.json(await svc.plans(requirePrincipal(req).userId));
  }));
  r.get("/growth/plans/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(PlanIdParam, req.params);
    res.json(await svc.planDetail(requirePrincipal(req).userId, id));
  }));
  r.post("/growth/plans/:id/start", auth, handler(async (req, res) => {
    const { id } = parseBody(PlanIdParam, req.params);
    res.status(201).json(await svc.startPlan(requirePrincipal(req).userId, id));
  }));
  r.post("/growth/plans/:id/complete-day", auth, handler(async (req, res) => {
    const { id } = parseBody(PlanIdParam, req.params);
    const input = parseBody(GrowthContentService.CompleteDay, req.body);
    res.json(await svc.completeDay(requirePrincipal(req).userId, id, input));
  }));

  r.get("/growth/resources", auth, handler(async (_req, res) => {
    res.json(await svc.resources());
  }));

  r.get("/growth/mentor", auth, handler(async (req, res) => {
    res.json(await svc.mentor(requirePrincipal(req).userId));
  }));

  // ───────────────── Admin authoring (Admin+) — every mobile growth element
  // is editable from the portal. Audited; member reads above are unaffected.

  // Devotionals
  r.get("/admin/growth/devotionals", ...adminOnly, handler(async (_req, res) => res.json({ data: await adminSvc.listDevotionals() })));
  r.post("/admin/growth/devotionals", ...adminOnly, handler(async (req, res) => res.status(201).json(await adminSvc.createDevotional(requirePrincipal(req).userId, parseBody(AdminGrowthService.Devotional, req.body)))));
  r.put("/admin/growth/devotionals/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.updateDevotional(requirePrincipal(req).userId, idOf(req), parseBody(AdminGrowthService.Devotional.partial(), req.body)))));
  r.delete("/admin/growth/devotionals/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.deleteDevotional(requirePrincipal(req).userId, idOf(req)))));

  // Memory verses
  r.get("/admin/growth/memory-verses", ...adminOnly, handler(async (_req, res) => res.json({ data: await adminSvc.listVerses() })));
  r.post("/admin/growth/memory-verses", ...adminOnly, handler(async (req, res) => res.status(201).json(await adminSvc.createVerse(requirePrincipal(req).userId, parseBody(AdminGrowthService.Verse, req.body)))));
  r.put("/admin/growth/memory-verses/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.updateVerse(requirePrincipal(req).userId, idOf(req), parseBody(AdminGrowthService.Verse.partial(), req.body)))));
  r.delete("/admin/growth/memory-verses/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.deleteVerse(requirePrincipal(req).userId, idOf(req)))));

  // Reading plans (+ days)
  r.get("/admin/growth/plans", ...adminOnly, handler(async (_req, res) => res.json({ data: await adminSvc.listPlans() })));
  r.get("/admin/growth/plans/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.planDetail(idOf(req)))));
  r.post("/admin/growth/plans", ...adminOnly, handler(async (req, res) => res.status(201).json(await adminSvc.createPlan(requirePrincipal(req).userId, parseBody(AdminGrowthService.Plan, req.body)))));
  r.put("/admin/growth/plans/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.updatePlan(requirePrincipal(req).userId, idOf(req), parseBody(AdminGrowthService.Plan.partial(), req.body)))));
  r.delete("/admin/growth/plans/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.deletePlan(requirePrincipal(req).userId, idOf(req)))));

  // Resources
  r.get("/admin/growth/resources", ...adminOnly, handler(async (_req, res) => res.json({ data: await adminSvc.listResources() })));
  r.post("/admin/growth/resources", ...adminOnly, handler(async (req, res) => res.status(201).json(await adminSvc.createResource(requirePrincipal(req).userId, parseBody(AdminGrowthService.Resource, req.body)))));
  r.put("/admin/growth/resources/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.updateResource(requirePrincipal(req).userId, idOf(req), parseBody(AdminGrowthService.Resource.partial(), req.body)))));
  r.delete("/admin/growth/resources/:id", ...adminOnly, handler(async (req, res) => res.json(await adminSvc.deleteResource(requirePrincipal(req).userId, idOf(req)))));

  return r;
}
