// Module: announcements (Design Contract Matrix B5)
// Admin composes/schedules multi-channel announcements; members fetch their
// in-app banners and post open receipts. All admin routes are Admin+.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AnnouncementService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const announcementsRouter: Router = Router();

export function registerAnnouncements(ctx: AppContext, svc?: AnnouncementService): Router {
  const service = svc ?? new AnnouncementService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = announcementsRouter;

  // ---- Admin ----
  r.get("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const q = parseBody(AnnouncementService.List, req.query);
    res.json(await service.list(q));
  }));

  r.post("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(AnnouncementService.Compose, req.body);
    res.status(201).json(await service.create(requirePrincipal(req).userId, input));
  }));

  r.get("/admin/announcements/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.get(id));
  }));

  r.put("/admin/announcements/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(AnnouncementService.Compose, req.body);
    res.json(await service.update(requirePrincipal(req).userId, id, input));
  }));

  r.post("/admin/announcements/:id/send", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.send(requirePrincipal(req).userId, id));
  }));

  r.post("/admin/announcements/:id/cancel", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.cancel(requirePrincipal(req).userId, id));
  }));

  // ---- Member ----
  r.get("/me/announcements", auth, handler(async (req, res) => {
    res.json(await service.myAnnouncements(requirePrincipal(req).userId));
  }));

  r.post("/announcements/:id/open", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.markOpened(requirePrincipal(req).userId, id));
  }));

  return r;
}
