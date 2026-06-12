// Module: assessment (spec §1.5)
// Owns: Randomised quiz assembly, server-side scoring, attempt logs, reflection
// submission & review queue. Endpoints per §3.3 (assessment).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AssessmentService } from "./service.js";
import { ReflectionService } from "./reflection.js";
import { ModuleReflectionService } from "./moduleReflection.js";
import { ExamService } from "./exam.js";

export const assessmentRouter: Router = Router();

export function registerAssessment(ctx: AppContext): Router {
  const svc = new AssessmentService(ctx.db.primary);
  const reflections = new ReflectionService(ctx.db.primary);
  const moduleReflections = new ModuleReflectionService(ctx.db.primary);
  const exams = new ExamService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const leaderPlus = [auth, requireRole("Instructor")] as const;
  const r = assessmentRouter;

  // ---- Module reflections (Contract Matrix B3) ----
  // The member's own reflection state + reviewer feedback (never the pastoral note).
  r.get(
    "/modules/:id/reflection",
    auth,
    handler(async (req, res) => {
      res.json(await moduleReflections.myReflection(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Reviewer queue — cell-scoped for Instructors, congregation-wide for Admin+.
  r.get(
    "/admin/reflections",
    ...leaderPlus,
    handler(async (req, res) => {
      const q = parseBody(ModuleReflectionService.Queue, req.query);
      res.json({ data: await moduleReflections.queue(requirePrincipal(req), q) });
    }),
  );

  r.post(
    "/admin/reflections/:id/decision",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(ModuleReflectionService.Decision, req.body ?? {});
      res.json(await moduleReflections.decide(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.get(
    "/admin/reflections/:id/history",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json({ data: await moduleReflections.history(requirePrincipal(req), req.params.id ?? "") });
    }),
  );

  // Assemble a randomized quiz for an unlocked module (no answers leaked).
  r.get(
    "/modules/:id/quiz",
    auth,
    handler(async (req, res) => {
      res.json(await svc.assembleQuiz(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Submit answers; scored server-side, returns the result + any unlock.
  r.post(
    "/modules/:id/quiz/attempts",
    auth,
    handler(async (req, res) => {
      const sub = parseBody(AssessmentService.QuizSubmission, req.body);
      res.json(await svc.submitQuiz(requirePrincipal(req).userId, req.params.id ?? "", sub));
    }),
  );

  // --- Level exam (§1.9 rule 2) ---
  r.get(
    "/levels/:n/exam",
    auth,
    handler(async (req, res) => {
      const n = parseBody(z.coerce.number().int().min(1), req.params.n);
      res.json(await exams.assemble(requirePrincipal(req).userId, n));
    }),
  );

  r.post(
    "/levels/:n/exam/attempts",
    auth,
    handler(async (req, res) => {
      const n = parseBody(z.coerce.number().int().min(1), req.params.n);
      const sub = parseBody(ExamService.ExamSubmission, req.body);
      res.json(await exams.submit(requirePrincipal(req).userId, n, sub));
    }),
  );

  // --- Reflection submission + review queue (§1.9 rule 3) ---
  r.post(
    "/levels/:n/reflection",
    auth,
    handler(async (req, res) => {
      const n = parseBody(z.coerce.number().int().min(1), req.params.n);
      const body = parseBody(ReflectionService.SubmitSchema, req.body);
      res.status(201).json(await reflections.submit(requirePrincipal(req).userId, n, body.reflection_text));
    }),
  );

  // Review queue — Instructor+ only, scoped to assigned cohorts (§5.4).
  r.get(
    "/reviews",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      res.json({ data: await reflections.listPending(requirePrincipal(req)) });
    }),
  );

  r.post(
    "/reviews/:id/decision",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const body = parseBody(ReflectionService.DecisionSchema, req.body);
      res.json(await reflections.decide(requirePrincipal(req), req.params.id ?? "", body));
    }),
  );

  return r;
}
