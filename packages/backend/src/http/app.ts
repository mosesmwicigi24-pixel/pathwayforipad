// Express app assembly. The app is the modular monolith host: it builds the
// shared AppContext, then mounts each logical module under /v1 (§1.5, §3.1).
// Edge concerns the spec terminates at the gateway (TLS, WAF) aren't duplicated;
// app-level hardening here is defense-in-depth (§5.8): helmet, body caps, rate
// limiting, request correlation, structured logs with secret redaction (§4.7).
import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import helmet from "helmet";
import { ApiError } from "./errors.js";
import type { AppContext } from "./context.js";
import { traceMiddleware } from "./trace.js";
import { MetricsRecorder, metricsMiddleware } from "./metrics.js";
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  rateLimit,
  byUserOrIp,
  byIp,
  type RateLimitStore,
} from "./rateLimit.js";

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
import { registerCalendar } from "../modules/calendar/index.js";
import { registerAdminOps } from "../modules/adminops/index.js";
import { registerOnboarding } from "../modules/onboarding/index.js";
import { registerGamification } from "../modules/gamification/index.js";
import { registerAnnouncements } from "../modules/announcements/index.js";
import { registerGrowth } from "../modules/growth/index.js";
import { registerCommunity } from "../modules/community/index.js";
import { registerGrowthContent } from "../modules/growth-content/index.js";
import { registerScores } from "../modules/scores/index.js";
import { registerChat } from "../modules/chat/index.js";
import { registerAssistant } from "../modules/assistant/index.js";
import { registerSystem } from "../modules/system/index.js";
import { registerEncouragements } from "../modules/encouragements/index.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet()); // security headers (§5.8)

  // Trace context (§4.7) + RED request metrics.
  const metrics = new MetricsRecorder();
  app.use(traceMiddleware());
  app.use(metricsMiddleware(metrics));

  // Rate-limit store: Redis when configured (horizontally correct), else in-memory.
  const rl: RateLimitStore = ctx.redis ? new RedisRateLimitStore(ctx.redis) : new InMemoryRateLimitStore();

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

  // Parse JSON for everything EXCEPT payment webhooks, which need the raw body
  // bytes for HMAC signature verification (§3.5). Payload cap mirrors §5.8.
  const json = express.json({ limit: "256kb" });
  app.use((req, res, next) => {
    if (req.path.startsWith("/v1/webhooks/")) return next();
    json(req, res, next);
  });

  // Correlation id (§3.1 / §4.7): reuse the gateway's header or mint one.
  app.use((req, res, next) => {
    const id = (req.header("X-Request-Id") ?? randomUUID()).slice(0, 64);
    res.setHeader("X-Request-Id", id);
    res.locals.requestId = id;
    next();
  });

  // Structured per-request logging (§4.7), correlated to the request id; secrets
  // and tokens are redacted so they never reach the logs (§5.8/§5.10).
  app.use(
    pinoHttp({
      logger: ctx.log,
      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'req.headers["stripe-signature"]'],
        remove: true,
      },
    }),
  );

  // Health (liveness) + metrics. Readiness checks dependencies are reachable.
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/metrics", (_req, res) => res.json(metrics.snapshot()));
  app.get("/readyz", (_req, res) => {
    void (async () => {
      try {
        await ctx.db.primary.query("SELECT 1");
        if (ctx.redis) await ctx.redis.ping();
        res.json({ status: "ready" });
      } catch {
        res.status(503).json({ status: "degraded" });
      }
    })();
  });

  // Global limiter (per user/IP) + stricter buckets on auth, payment and sync (§5.8).
  app.use(rateLimit({ store: rl, name: "global", capacity: 300, refillPerSec: 5, keyBy: byUserOrIp }));
  app.use("/v1/auth", rateLimit({ store: rl, name: "auth", capacity: 20, refillPerSec: 0.5, keyBy: byIp }));
  // Strict payment bucket guards money WRITES (intents, schedule create/cancel).
  // Read GETs (history, schedules, statement) skip it — they'd otherwise drain the
  // 30-token bucket on a normal Give→Statement visit and 429 — and fall to global.
  app.use("/v1/giving", rateLimit({ store: rl, name: "pay", capacity: 30, refillPerSec: 1, keyBy: byUserOrIp, skip: (req) => req.method === "GET" }));
  app.use("/v1/sync", rateLimit({ store: rl, name: "sync", capacity: 120, refillPerSec: 4, keyBy: byUserOrIp }));
  app.use("/v1/assistant", rateLimit({ store: rl, name: "ai", capacity: 20, refillPerSec: 0.2, keyBy: byUserOrIp }));

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
  v1.use(registerCalendar(ctx));
  v1.use(registerOnboarding(ctx));
  v1.use(registerGamification(ctx));
  v1.use(registerAdminOps(ctx));
  v1.use(registerAnnouncements(ctx));
  v1.use(registerGrowth(ctx));
  v1.use(registerCommunity(ctx));
  v1.use(registerChat(ctx));
  v1.use(registerAssistant(ctx));
  v1.use(registerGrowthContent(ctx));
  v1.use(registerScores(ctx));
  v1.use(registerSystem(ctx));
  v1.use(registerEncouragements(ctx));
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
