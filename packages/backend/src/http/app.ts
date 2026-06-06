// Express app assembly. The app is the modular monolith host: it builds the
// shared AppContext, then mounts each logical module under /v1 (§1.5, §3.1).
// Cross-cutting concerns that the spec terminates at the gateway (TLS, JWT
// signature checks, WAF, rate limiting — §1.4) are intentionally NOT duplicated
// here; this process trusts the signed internal identity headers the gateway
// forwards. Per-request correlation echoes X-Request-Id (§3.1, §4.7).
import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { ApiError } from "./errors.js";
import type { AppContext } from "./context.js";

import { registerIdentity } from "../modules/identity/index.js";
import { registerCurriculum } from "../modules/curriculum/index.js";
import { registerProgress } from "../modules/progress/index.js";
import { registerAssessment } from "../modules/assessment/index.js";
import { registerEngagement } from "../modules/engagement/index.js";
import { registerFinancial } from "../modules/financial/index.js";
import { registerNotifications } from "../modules/notifications/index.js";
import { registerCertificates } from "../modules/certificates/index.js";
import { registerSync } from "../modules/sync/index.js";
import { registerMedia } from "../modules/media/index.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");

  // Dev-only CORS so the local portal (:5173) can call the API (:8080). In
  // production the API gateway terminates CORS (§1.4), so this is never enabled.
  if (ctx.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
      const origin = req.header("Origin");
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-Id");
      }
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }
  // Parse JSON for everything EXCEPT the Stripe webhook, which needs the raw body
  // bytes for HMAC signature verification (§3.5). That route installs its own
  // express.raw() parser. Payload cap mirrors §5.8 hardening.
  const json = express.json({ limit: "256kb" });
  app.use((req, res, next) => {
    if (req.path === "/v1/webhooks/stripe") return next();
    json(req, res, next);
  });

  // Correlation id (§3.1 / §4.7): reuse the gateway's header or mint one.
  app.use((req, res, next) => {
    const id = (req.header("X-Request-Id") ?? randomUUID()).slice(0, 64);
    res.setHeader("X-Request-Id", id);
    res.locals.requestId = id;
    next();
  });

  // Structured per-request logging (§4.7), correlated to the request id.
  app.use(
    pinoHttp({
      logger: ctx.log,
      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
    }),
  );

  // Liveness: the process is up. Readiness: dependencies (DB) are reachable.
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/readyz", (_req, res) => {
    ctx.db.primary
      .query("SELECT 1")
      .then(() => res.json({ status: "ready" }))
      .catch(() => res.status(503).json({ status: "degraded" }));
  });

  // Mount the ten logical modules under the versioned base path (§3.1).
  const v1 = express.Router();
  v1.use(registerIdentity(ctx));
  v1.use(registerCurriculum(ctx));
  v1.use(registerProgress(ctx));
  v1.use(registerAssessment(ctx));
  v1.use(registerEngagement(ctx));
  v1.use(registerFinancial(ctx));
  v1.use(registerNotifications(ctx));
  v1.use(registerCertificates(ctx));
  v1.use(registerSync(ctx));
  v1.use(registerMedia(ctx));
  app.use("/v1", v1);

  // Terminal error handler — always emits the §3.2 envelope.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const requestId = String(res.locals.requestId ?? "unknown");
      if (err instanceof ApiError) {
        res.status(err.status).json(err.toBody(requestId));
        return;
      }
      ctx.log.error({ err, requestId }, "unhandled error");
      res.status(500).json({
        error: { code: "INTERNAL", message: "Internal server error", request_id: requestId },
      });
    },
  );

  return app;
}
