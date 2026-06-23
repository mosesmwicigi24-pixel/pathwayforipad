// Module: home — server-driven home feed (§1.1). Starts with the Next-Best-Action
// hero slot; future slots (ordered feed) live behind the same module.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, requirePrincipal } from "../../http/http.js";
import { HomeService } from "./service.js";

export const homeRouter: Router = Router();

export function registerHome(ctx: AppContext): Router {
  const svc = new HomeService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = homeRouter;

  // The single most valuable next step for this member (the Home hero card).
  r.get("/me/home/next-action", auth, handler(async (req, res) => {
    res.json(await svc.nextAction(requirePrincipal(req).userId));
  }));

  return r;
}
