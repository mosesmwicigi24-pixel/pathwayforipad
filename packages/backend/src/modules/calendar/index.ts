// Module: calendar (Features v2 §C)
// Owns: event series (recurrence), occurrence projection, exceptions, RSVPs, and
// chrono-node quick-add. Visibility-scoped (§5.4); recurrence validated + capped.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CalendarService } from "./service.js";
import { AttendanceService } from "../progress/attendance.js";

export const calendarRouter: Router = Router();

export function registerCalendar(ctx: AppContext): Router {
  const svc = new CalendarService(ctx.db.primary, ctx.env.CAL_MATERIALIZE_HORIZON_DAYS, ctx.env.CAL_MAX_INSTANCES);
  const attendance = new AttendanceService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const leaderPlus = [auth, requireRole("Instructor")] as const;
  const r = calendarRouter;

  // Projected occurrences in a bounded window.
  r.get(
    "/calendar",
    auth,
    handler(async (req, res) => {
      const q = parseBody(z.object({ from: z.string().min(1), to: z.string().min(1) }), req.query);
      res.json({ data: await svc.projectRange(requirePrincipal(req).userId, q.from, q.to) });
    }),
  );

  r.get(
    "/events/:id",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getEvent(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  r.post(
    "/events/:id/rsvp",
    auth,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.Rsvp, req.body ?? {});
      res.json(await svc.setRsvp(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );

  // The member's upcoming RSVPs ("My RSVPs", Contract Matrix B2).
  r.get(
    "/me/rsvps",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.myRsvps(requirePrincipal(req).userId) });
    }),
  );

  // Events tab: followable series + follow toggle ("Series you follow").
  r.get(
    "/calendar/series",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listSeries(requirePrincipal(req).userId) });
    }),
  );
  r.post(
    "/calendar/series/:id/follow",
    auth,
    handler(async (req, res) => {
      res.json(await svc.toggleFollow(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Events tab: the member's cell summary card (cell · members · attendance · next).
  r.get(
    "/me/cell-summary",
    auth,
    handler(async (req, res) => {
      res.json(await svc.cellSummary(requirePrincipal(req).userId));
    }),
  );

  // ---- Leader attendance ops (Contract Matrix B2; cell-scoped, audited) ----
  r.post(
    "/admin/events/:id/checkins",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(AttendanceService.ManualCheckIn, req.body ?? {});
      res.status(201).json(await attendance.manualCheckIn(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.post(
    "/admin/events/:id/guests",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(AttendanceService.AddGuest, req.body ?? {});
      res.status(201).json(await attendance.addGuest(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.get(
    "/admin/events/:id/attendance",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await attendance.roster(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // RSVP roster for one occurrence — buckets + counts (Events page; cell-scoped).
  r.get(
    "/admin/events/:id/rsvps",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await svc.rsvpRoster(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // NLP quick-add — suggestion only; never auto-creates. Leader+ (CPU-bound).
  r.post(
    "/calendar/parse",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(z.object({ text: z.string().min(1).max(500), timezone: z.string().min(1).max(64) }), req.body ?? {});
      res.json(svc.parse(input.text, input.timezone));
    }),
  );

  // --- Admin / Instructor: series management ---
  r.post(
    "/admin/events/series",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.CreateSeries, req.body ?? {});
      res.status(201).json(await svc.createSeries(requirePrincipal(req), input));
    }),
  );

  r.put(
    "/admin/events/series/:id",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.UpdateSeries, req.body ?? {});
      res.json(await svc.updateSeries(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.post(
    "/admin/events/series/:id/exceptions",
    ...leaderPlus,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.Exception, req.body ?? {});
      res.status(201).json(await svc.addException(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.delete(
    "/admin/events/series/:id",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await svc.deleteSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // Pause / resume a series — paused series stop projecting future occurrences.
  r.post(
    "/admin/events/series/:id/pause",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await svc.pauseSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  r.post(
    "/admin/events/series/:id/resume",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await svc.resumeSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  return r;
}
