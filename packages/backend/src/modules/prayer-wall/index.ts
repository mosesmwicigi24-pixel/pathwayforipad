// Module: prayer-wall — public, congregation-scoped prayer requests (opt-in),
// with 🙏/emoji reactions and comments. The private journal stays in `growth`.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { PrayerWallService } from "./service.js";

export const prayerWallRouter: Router = Router();
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export function registerPrayerWall(ctx: AppContext): Router {
  const svc = new PrayerWallService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = prayerWallRouter;

  r.get("/prayer-wall", auth, handler(async (req, res) => {
    const sort = req.query.sort === "prayed" ? "prayed" : "latest";
    res.json(await svc.list(requirePrincipal(req).userId, sort));
  }));
  r.post("/prayer-wall", auth, handler(async (req, res) => {
    res.status(201).json(await svc.create(requirePrincipal(req).userId, parseBody(PrayerWallService.Post, req.body)));
  }));
  r.get("/prayer-wall/:id", auth, handler(async (req, res) => {
    res.json(await svc.get(requirePrincipal(req).userId, idOf(req)));
  }));
  r.post("/prayer-wall/:id/reactions", auth, handler(async (req, res) => {
    const { emoji } = parseBody(PrayerWallService.Reaction, req.body);
    res.json(await svc.toggleReaction(requirePrincipal(req).userId, idOf(req), emoji));
  }));
  r.post("/prayer-wall/:id/comments", auth, handler(async (req, res) => {
    res.status(201).json(await svc.comment(requirePrincipal(req).userId, idOf(req), parseBody(PrayerWallService.Comment, req.body)));
  }));
  r.post("/prayer-wall/:id/answered", auth, handler(async (req, res) => {
    const { answered } = parseBody(z.object({ answered: z.boolean() }), req.body);
    res.json(await svc.setAnswered(requirePrincipal(req).userId, idOf(req), answered));
  }));
  r.delete("/prayer-wall/:id", auth, handler(async (req, res) => {
    res.json(await svc.remove(requirePrincipal(req).userId, idOf(req)));
  }));

  // Share one of MY private journal prayers to the public wall.
  r.post("/me/prayers/:id/share-to-wall", auth, handler(async (req, res) => {
    res.status(201).json(await svc.shareFromJournal(requirePrincipal(req).userId, idOf(req)));
  }));

  // Home carousel — most-prayed recent requests in my congregation.
  r.get("/home/prayer-wall", auth, handler(async (req, res) => {
    res.json(await svc.home(requirePrincipal(req).userId));
  }));

  return r;
}
