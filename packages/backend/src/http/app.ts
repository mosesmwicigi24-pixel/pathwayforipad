// Express app assembly. The app is the modular monolith host: it builds the
// shared AppContext, then mounts each logical module under /v1 (§1.5, §3.1).
// Cross-cutting concerns that the spec terminates at the gateway (TLS, JWT
// signature checks, WAF, rate limiting — §1.4) are intentionally NOT duplicated
// here; this process trusts the signed internal identity headers the gateway
// forwards. Per-request correlation echoes X-Request-Id (§3.1, §4.7).
import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
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
  app.use(express.json({ limit: "256kb" })); // payload cap mirrors §5.8 hardening

  // Correlation id (§3.1 / §4.7): reuse the gateway's header or mint one.
  app.use((req, res, next) => {
    const id = (req.header("X-Request-Id") ?? randomUUID()).slice(0, 64);
    res.setHeader("X-Request-Id", id);
    res.locals.requestId = id;
    next();
  });

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

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
