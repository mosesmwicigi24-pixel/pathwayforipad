// Module: progress (spec §1.5)
// Owns: Enrollments, module progress, the sequential unlock/gating engine, level
// transitions. Endpoint per §3.3 (POST /modules/{id}/complete).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ProgressService } from "./service.js";
import { AttendanceService } from "./attendance.js";

export const progressRouter: Router = Router();

export function registerProgress(ctx: AppContext): Router {
  const svc = new ProgressService(ctx.db.primary);
  const attendance = new AttendanceService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = progressRouter;

  r.post(
    "/modules/:id/complete",
    auth,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({
          client_mutation_id: z.string().uuid().nullable().optional(),
          completed_at: z.string().optional(),
          reflection_text: z.string().min(1).optional(),
        }),
        req.body ?? {},
      );
      const result = await svc.completeModule(
        requirePrincipal(req).userId,
        req.params.id ?? "",
        body.client_mutation_id ?? null,
        body.completed_at,
        body.reflection_text,
      );
      res.status(200).json(result);
    }),
  );

  // QR attendance check-in (§3.3): validates the scan token, idempotent.
  r.post(
    "/events/:id/attendance",
    auth,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ client_scan_id: z.string().uuid(), scan_token: z.string().min(1) }),
        req.body ?? {},
      );
      res.status(201).json(await attendance.checkIn(requirePrincipal(req).userId, req.params.id ?? "", body));
    }),
  );

  return r;
}
