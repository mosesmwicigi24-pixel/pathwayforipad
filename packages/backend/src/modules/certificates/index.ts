// Module: certificates (spec §1.5, §5.5)
// Owns: tamper-evident credential issuance (outbox-driven), the caller's
// certificate list, and the public verification endpoint.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, requirePrincipal } from "../../http/http.js";
import { CertificateService } from "./service.js";

export const certificatesRouter: Router = Router();

export function registerCertificates(ctx: AppContext): Router {
  const svc = new CertificateService(ctx.db.primary, ctx.env.CERT_SIGNING_KEY ?? ctx.env.JWT_SIGNING_KEY);
  const auth = authenticate(ctx.env);
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

  return r;
}
