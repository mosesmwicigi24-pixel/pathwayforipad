// Module: home — server-driven home feed (§1.1). Starts with the Next-Best-Action
// hero slot; future slots (ordered feed) live behind the same module.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { HomeService } from "./service.js";
import { buildAiProvider } from "../assistant/provider.js";

// The reactions offered on the Verse for today (kept in sync with the mobile card).
const REACTIONS = ["❤️", "🙏", "🔥", "🙌", "👍"] as const;

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

  // Community reactions on today's shared verse (counts per emoji + my reaction).
  r.get("/me/home/verse/reactions", auth, handler(async (req, res) => {
    res.json(await svc.verseReactions(requirePrincipal(req).userId));
  }));
  // Set/toggle my reaction — exactly one per member per day (switching moves it).
  const ReactBody = z.object({ emoji: z.enum(REACTIONS) });
  r.post("/me/home/verse/reactions", auth, handler(async (req, res) => {
    const { emoji } = parseBody(ReactBody, req.body);
    res.json(await svc.setVerseReaction(requirePrincipal(req).userId, emoji));
  }));

  return r;
}
