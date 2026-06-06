// Module: onboarding (Features v2 §O)
// Owns: the resumable first-run stepper (profile → cell → consent → literacy →
// notifications → done), guardian consent enforcement for minors, and the cell
// directory. Finalize reuses identity.onboard(). Server-held state, resumable.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { OnboardingService } from "./service.js";

export const onboardingRouter: Router = Router();

export function registerOnboarding(ctx: AppContext): Router {
  const svc = new OnboardingService(ctx.db.primary, ctx.env);
  const auth = authenticate(ctx.env);
  const r = onboardingRouter;
  const uid = (req: Parameters<typeof requirePrincipal>[0]) => requirePrincipal(req).userId;

  r.get("/onboarding", auth, handler(async (req, res) => {
    res.json(await svc.getSession(uid(req)));
  }));

  r.put("/onboarding/steps/profile", auth, handler(async (req, res) => {
    res.json(await svc.putProfile(uid(req), parseBody(OnboardingService.Profile, req.body ?? {})));
  }));

  r.put("/onboarding/steps/cell_selection", auth, handler(async (req, res) => {
    res.json(await svc.putCellSelection(uid(req), parseBody(OnboardingService.CellSelection, req.body ?? {})));
  }));

  r.put("/onboarding/steps/guardian_consent", auth, handler(async (req, res) => {
    const p = requirePrincipal(req);
    res.json(await svc.putGuardianConsent(p.userId, p.userId, parseBody(OnboardingService.GuardianConsent, req.body ?? {})));
  }));

  r.get("/onboarding/literacy-quiz", auth, handler(async (_req, res) => {
    res.json(svc.getLiteracyQuiz());
  }));

  r.put("/onboarding/steps/literacy_quiz", auth, handler(async (req, res) => {
    res.json(await svc.putLiteracyQuiz(uid(req), parseBody(OnboardingService.LiteracyAnswers, req.body ?? {})));
  }));

  r.put("/onboarding/steps/notifications", auth, handler(async (req, res) => {
    res.json(await svc.putNotifications(uid(req), parseBody(OnboardingService.Notifications, req.body ?? {})));
  }));

  r.post("/onboarding/finalize", auth, handler(async (req, res) => {
    res.status(201).json(await svc.finalize(uid(req)));
  }));

  // Minimal-field cell directory for selection (auth + rate-limited at the edge).
  r.get("/directory/cell-groups", auth, handler(async (req, res) => {
    const q = parseBody(z.object({ congregation: z.string().uuid().optional(), search: z.string().max(100).optional() }), req.query);
    const congregation = q.congregation ?? requirePrincipal(req).congregationId;
    res.json({ data: await svc.directory(congregation, q.search) });
  }));

  return r;
}
