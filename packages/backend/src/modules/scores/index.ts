// Module: scores — member-facing growth scores (server-authoritative, §1.1).
// Each score is the member's own; leader/aggregate exposure stays on the
// engagement module (k-anonymised). Word ships first.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, requirePrincipal } from "../../http/http.js";
import { ScoresService } from "./service.js";

export const scoresRouter: Router = Router();

export function registerScores(ctx: AppContext): Router {
  const svc = new ScoresService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = scoresRouter;

  // "How is the Word taking root in you?" — consistency + memorization + breadth.
  r.get("/me/scores/word", auth, handler(async (req, res) => {
    res.json(await svc.word(requirePrincipal(req).userId));
  }));

  return r;
}
