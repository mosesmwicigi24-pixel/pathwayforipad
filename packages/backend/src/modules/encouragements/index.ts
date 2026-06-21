// Module: encouragements (Pathway trail motivational content)
// Member read of a level's encouragements + Admin authoring. Member reads are
// non-sensitive (motivational copy); lesson content gating stays in curriculum.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { EncouragementsService } from "./service.js";

const LevelParam = z.object({ n: z.coerce.number().int().min(1).max(99) });
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export const encouragementsRouter: Router = Router();

export function registerEncouragements(ctx: AppContext): Router {
  const svc = new EncouragementsService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = encouragementsRouter;

  // ---- Member: a level's active encouragements, in trail order ----
  r.get("/levels/:n/encouragements", auth, handler(async (req, res) => {
    const { n } = parseBody(LevelParam, req.params);
    res.json({ data: await svc.listForLevel(n) });
  }));

  // ---- Admin authoring (Admin+) ----
  r.get("/admin/levels/:n/encouragements", ...adminOnly, handler(async (req, res) => {
    const { n } = parseBody(LevelParam, req.params);
    res.json({ data: await svc.adminList(n) });
  }));
  r.post("/admin/levels/:n/encouragements", ...adminOnly, handler(async (req, res) => {
    const { n } = parseBody(LevelParam, req.params);
    res.status(201).json(await svc.create(requirePrincipal(req).userId, n, parseBody(EncouragementsService.Input, req.body)));
  }));
  r.put("/admin/encouragements/:id", ...adminOnly, handler(async (req, res) => {
    res.json(await svc.update(requirePrincipal(req).userId, idOf(req), parseBody(EncouragementsService.Input.partial(), req.body)));
  }));
  r.delete("/admin/encouragements/:id", ...adminOnly, handler(async (req, res) => {
    res.json(await svc.remove(requirePrincipal(req).userId, idOf(req)));
  }));

  return r;
}
