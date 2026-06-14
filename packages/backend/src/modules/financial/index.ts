// Module: financial (spec §1.5, §1.10, §3.5, §5.6)
// Owns: giving, Stripe orchestration, the double-entry ledger, idempotent webhooks.
import express, { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { FinancialService } from "./service.js";
import { buildPaymentGateway, type PaymentGateway } from "./gateway.js";
import { buildMobileMoneyProviders, type MobileMoneyProviders } from "./providers.js";

export const financialRouter: Router = Router();

export function registerFinancial(
  ctx: AppContext,
  gatewayOverride?: PaymentGateway,
  mobileMoneyOverride?: MobileMoneyProviders,
): Router {
  const gateway = gatewayOverride ?? buildPaymentGateway(ctx.env);
  const mobileMoney = mobileMoneyOverride ?? buildMobileMoneyProviders(ctx.env);
  const svc = new FinancialService(ctx.db.primary, gateway, mobileMoney);
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

  // ---- Recurring giving (B7): managed online-only; the scheduler charges ----
  r.post(
    "/giving/schedules",
    auth,
    handler(async (req, res) => {
      const body = parseBody(FinancialService.CreateSchedule, req.body);
      res.status(201).json(await svc.createSchedule(requirePrincipal(req).userId, body));
    }),
  );

  r.get(
    "/giving/schedules",
    auth,
    handler(async (req, res) => {
      res.json(await svc.listSchedules(requirePrincipal(req).userId));
    }),
  );

  r.post(
    "/giving/schedules/:id/cancel",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      res.json(await svc.cancelSchedule(requirePrincipal(req).userId, id));
    }),
  );

  // ---- Admin finance reads (ERP, Contract Matrix B1; RBAC finance:view, §5.4) ----
  const perm = requirePermission(ctx.db.replica);

  r.get("/admin/finance/summary", auth, perm("finance", "view"), handler(async (_req, res) => {
    res.json(await svc.financeSummary());
  }));

  r.get("/admin/finance/transactions", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(FinancialService.ListTransactions, req.query);
    res.json(await svc.listTransactions(q));
  }));

  r.get("/admin/finance/ledger", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    res.json({ data: await svc.listLedger(q.limit) });
  }));

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

  // Mobile-money callbacks (B7): same trust model — no session auth, HMAC only.
  r.post(
    "/webhooks/mobilemoney/:provider",
    express.raw({ type: "*/*", limit: "256kb" }),
    handler(async (req, res) => {
      const { provider } = parseBody(z.object({ provider: z.enum(["mpesa", "airtel"]) }), req.params);
      const signature = req.header("x-mm-signature") ?? "";
      const body: Buffer | string = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});
      const result = await svc.handleMobileMoneyCallback(provider, body, signature);
      res.json({ received: true, ...result });
    }),
  );

  return r;
}
