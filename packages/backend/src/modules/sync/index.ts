// Module: sync (spec §1.5, §3.6)
// Owns: batch delta pull and ordered mutation-replay push for mobile clients,
// with the per-record conflict policy applied server-side.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { SyncService } from "./service.js";

export const syncRouter: Router = Router();

const PullSchema = z.object({
  device_id: z.string().uuid().optional(),
  cursors: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

const PushSchema = z.object({
  device_id: z.string().uuid().optional(),
  mutations: z
    .array(
      z.object({
        mutation_id: z.string().uuid(),
        seq: z.number().int(),
        domain: z.string().min(1),
        op: z.string().min(1),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(500),
});

export function registerSync(ctx: AppContext): Router {
  const svc = new SyncService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = syncRouter;

  r.post(
    "/sync/pull",
    auth,
    handler(async (req, res) => {
      const body = parseBody(PullSchema, req.body ?? {});
      res.json(await svc.pull(requirePrincipal(req).userId, body));
    }),
  );

  r.post(
    "/sync/push",
    auth,
    handler(async (req, res) => {
      const body = parseBody(PushSchema, req.body ?? {});
      res.json(await svc.push(requirePrincipal(req).userId, body));
    }),
  );

  return r;
}
