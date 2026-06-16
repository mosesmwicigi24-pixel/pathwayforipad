// Module: adminops (Design Contract Matrix B1; web portal "ERP")
// Owns: dashboard report aggregates, congregation-wide member administration,
// and the audit viewer. Reports/members are Admin+; the audit log is SuperAdmin.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AdminOpsService } from "./service.js";

export const adminOpsRouter: Router = Router();

export function registerAdminOps(ctx: AppContext): Router {
  const svc = new AdminOpsService(ctx.db.primary, ctx.db.replica);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica); // RBAC: dashboard + members modules (§5.4)
  const superOnly = [auth, requireRole("SuperAdmin")] as const; // audit stays SuperAdmin-only
  const r = adminOpsRouter;

  // ---- Dashboard reports ----
  r.get("/admin/reports/overview", auth, perm("dashboard", "view"), handler(async (_req, res) => {
    res.json(await svc.overview());
  }));

  r.get("/admin/reports/engagement", auth, perm("dashboard", "view"), handler(async (_req, res) => {
    res.json(await svc.engagementReport());
  }));

  r.get("/admin/reports/attendance", auth, perm("dashboard", "view"), handler(async (req, res) => {
    const q = parseBody(z.object({ weeks: z.coerce.number().int().min(1).max(52).default(8) }), req.query);
    res.json(await svc.attendanceReport(q.weeks));
  }));

  r.get("/admin/reports/levels", auth, perm("dashboard", "view"), handler(async (_req, res) => {
    res.json(await svc.levelsReport());
  }));

  r.get("/admin/reports/consents", auth, perm("dashboard", "view"), handler(async (_req, res) => {
    res.json({ data: await svc.consentsReport() });
  }));

  // Portal activity feed (top-bar bell + Notifications page).
  r.get("/admin/notifications", auth, perm("dashboard", "view"), handler(async (req, res) => {
    res.json({ data: await svc.notificationsFeed(requirePrincipal(req).userId) });
  }));

  // Per-admin read/unread/dismiss state (follows the user across devices).
  r.post("/admin/notifications/:action", auth, perm("dashboard", "view"), handler(async (req, res) => {
    const action = String(req.params.action);
    if (action !== "read" && action !== "unread" && action !== "dismiss") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown notification action" } });
      return;
    }
    const body = parseBody(z.object({ ids: z.array(z.string().max(80)).max(500) }), req.body);
    res.json(await svc.markNotifications(requirePrincipal(req).userId, body.ids, action));
  }));

  // ---- Cells administration (Figma "New Cell") ----
  r.post("/admin/cells", auth, perm("members", "create"), handler(async (req, res) => {
    const input = parseBody(AdminOpsService.CreateCell, req.body);
    res.status(201).json(await svc.createCell(requirePrincipal(req).userId, input));
  }));

  // ---- Members administration ----
  r.get("/admin/members", auth, perm("members", "view"), handler(async (req, res) => {
    const q = parseBody(AdminOpsService.ListMembers, req.query);
    res.json(await svc.listMembers(q));
  }));

  r.post("/admin/members", auth, perm("members", "create"), handler(async (req, res) => {
    const input = parseBody(AdminOpsService.AddMember, req.body);
    res.status(201).json(await svc.addMember(requirePrincipal(req).userId, input));
  }));

  // Single-member aggregate for the Member Profile screen.
  r.get("/admin/members/:id", auth, perm("members", "view"), handler(async (req, res) => {
    res.json(await svc.memberDetail(req.params.id ?? ""));
  }));

  // Admin placement: set the member's starting level + entry module (§1.9).
  r.patch("/admin/members/:id/enrollment", auth, perm("members", "edit"), handler(async (req, res) => {
    const input = parseBody(AdminOpsService.SetStart, req.body);
    const userId = req.params.id ?? "";
    res.json(await svc.setEnrollmentStart(requirePrincipal(req).userId, userId, input));
  }));

  // ---- Audit viewer ----
  r.get("/admin/audit", ...superOnly, handler(async (req, res) => {
    const q = parseBody(AdminOpsService.ListAudit, req.query);
    res.json(await svc.listAudit(q));
  }));

  return r;
}
