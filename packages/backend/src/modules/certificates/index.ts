// Module: certificates (spec §1.5, §5.5; Contract Matrix B1)
// Owns: tamper-evident credential issuance (outbox-driven), the caller's
// certificate list, the public verification endpoint, and the portal's admin
// register (list / manual issue / revoke-with-reason).
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CertificateService } from "./service.js";

export const certificatesRouter: Router = Router();

export function registerCertificates(ctx: AppContext): Router {
  const svc = new CertificateService(ctx.db.primary, ctx.env.CERT_SIGNING_KEY ?? ctx.env.JWT_SIGNING_KEY);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = certificatesRouter;

  r.get(
    "/certificates",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listForUser(requirePrincipal(req).userId) });
    }),
  );

  // Public: anyone holding a printed code can confirm authenticity (§5.5).
  r.get(
    "/verify/:code",
    handler(async (req, res) => {
      res.json(await svc.verify(req.params.code ?? ""));
    }),
  );

  // ---- Admin register (ERP) ----
  r.get("/admin/certificates", ...adminOnly, handler(async (req, res) => {
    const q = parseBody(CertificateService.ListAdmin, req.query);
    res.json(await svc.listAll(q));
  }));

  r.post("/admin/certificates", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(CertificateService.AdminIssue, req.body);
    res.status(201).json(await svc.adminIssue(requirePrincipal(req).userId, input));
  }));

  r.post("/admin/certificates/:id/revoke", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(CertificateService.Revoke, req.body);
    res.json(await svc.revoke(requirePrincipal(req).userId, req.params.id ?? "", input.reason));
  }));

  return r;
}
