// Backend entry point. Boots config → DB pools → logger → HTTP server, with a
// graceful shutdown that drains the pools. The 10 service modules ship inside
// this one process (modular monolith) and can be split later (§1.5).
import "dotenv/config";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { createPools, closePools } from "./db/pool.js";
import { createApp } from "./http/app.js";
import { OutboxWorker } from "./workers/outbox.js";
import { buildOutboxHandlers } from "./workers/handlers.js";
import { NotificationWorker } from "./workers/notificationWorker.js";
import { buildDispatchProvider } from "./workers/dispatch.js";
import { NudgeScanner } from "./workers/nudgeScanner.js";
import { NotificationService } from "./modules/notifications/service.js";

function main(): void {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL });
  const db = createPools(env);
  const ctx = { env, db, log };
  const app = createApp(ctx);

  // Background workers (modular monolith). Each is its own deployable in a split
  // topology; the contracts are unchanged (§1.6, §1.5, §1.8).
  const outbox = new OutboxWorker(db.primary, buildOutboxHandlers(ctx), log);
  const notifications = new NotificationWorker(db.primary, buildDispatchProvider(env, log), log);
  const nudges = new NudgeScanner(db.primary, new NotificationService(db.primary), log);
  const stopWorkers = [outbox.start(5_000), notifications.start(10_000), nudges.start(60 * 60 * 1000)];

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, region: env.AWS_REGION, env: env.NODE_ENV }, "nuru backend up");
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, "shutting down");
    for (const stop of stopWorkers) stop();
    server.close(() => {
      void closePools(db).then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
