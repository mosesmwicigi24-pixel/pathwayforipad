// Module: home — server-driven home feed (§1.1). Starts with the Next-Best-Action
// hero slot; future slots (ordered feed) live behind the same module.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, requirePrincipal } from "../../http/http.js";
import { HomeService } from "./service.js";
import { buildAiProvider } from "../assistant/provider.js";

export const homeRouter: Router = Router();

export function registerHome(ctx: AppContext): Router {
  const svc = new HomeService(ctx.db.primary, buildAiProvider(ctx.env));
  const auth = authenticate(ctx.env);
  const r = homeRouter;

  // The single most valuable next step for this member (the Home hero card).
  r.get("/me/home/next-action", auth, handler(async (req, res) => {
    res.json(await svc.nextAction(requirePrincipal(req).userId));
  }));

  // A warm, Nuru-written one-line greeting, personal to the member (cached/day).
  r.get("/me/home/greeting", auth, handler(async (req, res) => {
    res.json(await svc.dailyGreeting(requirePrincipal(req).userId));
  }));

  // The member's tailored "Verse for today" — a vetted reference chosen from a
  // curated, theme-tagged pool to match where they are spiritually (cached/day).
  r.get("/me/home/verse", auth, handler(async (req, res) => {
    res.json(await svc.verseForToday(requirePrincipal(req).userId));
  }));

  return r;
}
