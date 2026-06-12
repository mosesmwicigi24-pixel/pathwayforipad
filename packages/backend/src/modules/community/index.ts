// Module: community (Design Contract Matrix B8)
// Cell-scoped discussion threads + comments; leader moderation is Instructor+
// within leader_assignments (assertCellInScope inside the service, §5.4).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CommunityService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const communityRouter: Router = Router();

export function registerCommunity(ctx: AppContext): Router {
  const svc = new CommunityService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const leaderPlus = [auth, requireRole("Instructor")] as const;
  const r = communityRouter;

  // ---- Member (own cell only) ----
  r.get("/community/threads", auth, handler(async (req, res) => {
    res.json(await svc.listThreads(requirePrincipal(req).userId));
  }));

  r.post("/community/threads", auth, handler(async (req, res) => {
    const input = parseBody(CommunityService.CreateThread, req.body);
    res.status(201).json(await svc.createThread(requirePrincipal(req).userId, input));
  }));

  r.get("/community/threads/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.getThread(requirePrincipal(req).userId, id));
  }));

  r.post("/community/threads/:id/comments", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(CommunityService.CreateComment, req.body);
    res.status(201).json(await svc.addComment(requirePrincipal(req).userId, id, input));
  }));

  // ---- Leader moderation ----
  r.patch("/admin/community/threads/:id", ...leaderPlus, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(CommunityService.Moderate, req.body);
    res.json(await svc.moderateThread(requirePrincipal(req), id, input));
  }));

  r.post("/admin/community/comments/:id/hide", ...leaderPlus, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.hideComment(requirePrincipal(req), id));
  }));

  return r;
}
