// Module: gamification (Features v2 §G)
// Owns: badges, streaks, faithfulness milestones. No public leaderboards; awards
// are server-derived (read via sync pull). Aggregate-only cell encouragement.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { GamificationService } from "./service.js";

export const gamificationRouter: Router = Router();

export function registerGamification(ctx: AppContext): Router {
  const svc = new GamificationService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = gamificationRouter;

  r.get("/me/achievements", auth, handler(async (req, res) => {
    res.json(await svc.myAchievements(requirePrincipal(req).userId));
  }));

  r.get("/badges", auth, handler(async (_req, res) => {
    res.json({ data: await svc.listBadges() });
  }));

  r.get("/cells/:id/milestones", auth, handler(async (req, res) => {
    res.json(await svc.cellMilestones(requirePrincipal(req), req.params.id ?? ""));
  }));

  r.get("/members/:id/achievements", auth, handler(async (req, res) => {
    res.json(await svc.memberAchievements(requirePrincipal(req), req.params.id ?? ""));
  }));

  // Admin catalog (audited). Deactivation never revokes earned badges.
  r.post("/admin/badges", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(GamificationService.BadgeInput, req.body ?? {});
    res.status(201).json(await svc.createBadge(requirePrincipal(req).userId, input));
  }));

  r.delete("/admin/badges/:code", ...adminOnly, handler(async (req, res) => {
    res.json(await svc.deactivateBadge(requirePrincipal(req).userId, req.params.code ?? ""));
  }));

  r.post("/admin/members/:id/badges/:code/revoke", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(GamificationService.Revoke, req.body ?? {});
    res.json(await svc.revokeBadge(requirePrincipal(req).userId, req.params.id ?? "", req.params.code ?? "", input.reason));
  }));

  return r;
}
