// Module: growth (Design Contract Matrix B6)
// Spiritual-gifts assessment, prayer journal and verse library. Everything
// here is member-scoped — there are deliberately no admin/leader read routes
// for prayers (§5.4 pastoral privacy).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { GrowthService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const growthRouter: Router = Router();

export function registerGrowth(ctx: AppContext): Router {
  const svc = new GrowthService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = growthRouter;

  // ---- Spiritual gifts ----
  r.get("/gifts/questions", auth, handler(async (_req, res) => {
    res.json(await svc.giftQuestions());
  }));

  r.post("/gifts/assessments", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.GiftsSubmission, req.body);
    res.status(201).json(await svc.submitGifts(requirePrincipal(req).userId, input));
  }));

  r.get("/me/gifts", auth, handler(async (req, res) => {
    res.json(await svc.myGifts(requirePrincipal(req).userId));
  }));

  // ---- Prayer journal ----
  r.get("/me/prayers", auth, handler(async (req, res) => {
    res.json(await svc.myPrayers(requirePrincipal(req).userId));
  }));

  r.put("/me/prayers", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.PrayerUpsert, req.body);
    res.json(await svc.upsertPrayer(requirePrincipal(req).userId, input));
  }));

  r.delete("/me/prayers/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.deletePrayer(requirePrincipal(req).userId, id));
  }));

  // ---- Verse library ----
  r.get("/me/verses", auth, handler(async (req, res) => {
    res.json(await svc.myVerses(requirePrincipal(req).userId));
  }));

  r.put("/me/verses", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.VerseSave, req.body);
    res.json(await svc.saveVerse(requirePrincipal(req).userId, input));
  }));

  r.delete("/me/verses/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.deleteVerse(requirePrincipal(req).userId, id));
  }));

  return r;
}
