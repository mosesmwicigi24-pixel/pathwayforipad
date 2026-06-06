// Module: financial (spec §1.5, §1.10, §3.5, §5.6)
// Owns: giving, Stripe orchestration, the double-entry ledger, idempotent webhooks.
import express, { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { FinancialService } from "./service.js";
import { buildPaymentGateway, type PaymentGateway } from "./gateway.js";

export const financialRouter: Router = Router();

export function registerFinancial(ctx: AppContext, gatewayOverride?: PaymentGateway): Router {
  const gateway = gatewayOverride ?? buildPaymentGateway(ctx.env);
  const svc = new FinancialService(ctx.db.primary, gateway);
  const auth = authenticate(ctx.env);
  const r = financialRouter;

  r.post(
    "/giving/intents",
    auth,
    handler(async (req, res) => {
      const body = parseBody(FinancialService.GivingIntent, req.body);
      res.status(201).json(await svc.createGivingIntent(requirePrincipal(req).userId, body));
    }),
  );

  r.get(
    "/giving/history",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listGiving(requirePrincipal(req).userId) });
    }),
  );

  // Media store (§3.3): catalogue + purchase (access granted on the webhook).
  r.get(
    "/products",
    auth,
    handler(async (_req, res) => {
      res.json({ data: await svc.listProducts() });
    }),
  );

  r.post(
    "/products/:id/purchase",
    auth,
    handler(async (req, res) => {
      res.status(201).json(await svc.createPurchase(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Stripe webhook: no session auth — authenticity is the HMAC signature. Uses a
  // raw body parser (app.ts skips JSON for this path) so the signature verifies.
  r.post(
    "/webhooks/stripe",
    express.raw({ type: "*/*", limit: "256kb" }),
    handler(async (req, res) => {
      const signature = req.header("stripe-signature") ?? "";
      const body: Buffer | string = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});
      const result = await svc.handleWebhook(body, signature);
      res.json({ received: true, ...result });
    }),
  );

  return r;
}
