// Module: notifications (spec §1.5 + Design spec D1)
// Owns: push/email scheduling, the 12-nudge cadence, quiet hours — and the
// member-facing notification center (list + read-state). Scheduling itself is
// driven by the outbox/scanner workers; these routes are display state only.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { NotificationService } from "./service.js";

export const notificationsRouter: Router = Router();

export function registerNotifications(ctx: AppContext): Router {
  const svc = new NotificationService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = notificationsRouter;

  r.get(
    "/me/notifications",
    auth,
    handler(async (req, res) => {
      const q = parseBody(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
      res.json(await svc.listMine(requirePrincipal(req).userId, q.limit));
    }),
  );

  r.post(
    "/me/notifications/read",
    auth,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ ids: z.array(z.string().uuid()).min(1).optional() }).strict(),
        req.body ?? {},
      );
      res.json(await svc.markRead(requirePrincipal(req).userId, body.ids));
    }),
  );

  return r;
}
