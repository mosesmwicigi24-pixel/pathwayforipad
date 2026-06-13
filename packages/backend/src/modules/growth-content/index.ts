// Module: growth-content (Contract Matrix D5)
// Member-facing growth content + private progress: devotional, memory verses,
// reading plans, resources, mentor. All authenticated; content is shared,
// progress is the caller's own.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { GrowthContentService } from "./service.js";

const PlanIdParam = z.object({ id: z.string().uuid() });

export const growthContentRouter: Router = Router();

export function registerGrowthContent(ctx: AppContext): Router {
  const svc = new GrowthContentService(ctx.db.primary);
  const auth = authenticate(ctx.env);
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

  return r;
}
