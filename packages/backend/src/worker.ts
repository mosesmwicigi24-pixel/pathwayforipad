// Background worker process (spec §1.6, §1.8, §2.4, §5.9) — separate deployable
// from the API. Runs the frequent pollers (outbox drain, notification dispatch,
// re-engagement scan) on intervals and the daily jobs (engagement recompute,
// partition maintenance, is_minor refresh) on cron. Every job is idempotent and
// concurrency-safe (SKIP LOCKED / IF NOT EXISTS), so multiple worker replicas are
// fine. Graceful shutdown stops schedulers and drains the pools.
import "dotenv/config";
import { pino } from "pino";
import cron from "node-cron";
import { loadEnv } from "./config/env.js";
import { createPools, closePools } from "./db/pool.js";
import { buildRedis } from "./redis.js";
import { OutboxWorker } from "./workers/outbox.js";
import { buildOutboxHandlers } from "./workers/handlers.js";
import { NotificationWorker } from "./workers/notificationWorker.js";
import { buildDispatchProvider } from "./workers/dispatch.js";
import { NudgeScanner } from "./workers/nudgeScanner.js";
import { NotificationService } from "./modules/notifications/service.js";
import { EngagementService } from "./modules/engagement/service.js";
import { PartitionMaintenance, refreshMinorFlags } from "./jobs/maintenance.js";
import { GamificationService } from "./modules/gamification/service.js";
import { AnnouncementService } from "./modules/announcements/service.js";

function main(): void {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL });
  const db = createPools(env);
  const redis = buildRedis(env);
  const ctx = { env, db, log, redis };

  // Frequent pollers (their own intervals; each returns a stop()).
  const stops: Array<() => void> = [
    new OutboxWorker(db.primary, buildOutboxHandlers(ctx), log).start(5_000),
    new NotificationWorker(db.primary, buildDispatchProvider(env, log), log).start(10_000),
    new NudgeScanner(db.primary, new NotificationService(db.primary), log).start(60 * 60 * 1000),
  ];

  // Scheduled announcements: dispatch any whose send time has arrived (B5).
  // dispatchDue() is idempotent per (recipient, channel), so overlap is safe.
  const announcements = new AnnouncementService(db.primary);
  const annTimer = setInterval(
    () => void announcements.dispatchDue().catch((err) => log.error({ err }, "announcement dispatch failed")),
    60_000,
  );
  stops.push(() => clearInterval(annTimer));

  // Daily jobs on cron (server local time). Each guards its own errors.
  const engagement = new EngagementService(db.primary, db.replica);
  const partitions = new PartitionMaintenance(db.primary);
  const gamification = new GamificationService(db.primary);
  const safe = (label: string, fn: () => Promise<unknown>) => () =>
    void fn().catch((err) => log.error({ err }, `${label} failed`));

  const tasks = [
    cron.schedule("0 2 * * *", safe("engagement recompute", () => engagement.runRecompute())),
    cron.schedule("0 3 * * *", safe("partition maintenance", () => partitions.run())),
    cron.schedule("0 4 * * *", safe("is_minor refresh", () => refreshMinorFlags(db.primary))),
    cron.schedule("0 4 * * *", safe("streak recompute", () => gamification.recomputeActiveStreaks())),
  ];

  log.info({ region: env.AWS_REGION, env: env.NODE_ENV }, "nuru worker up");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker shutting down");
    for (const stop of stops) stop();
    for (const task of tasks) task.stop();
    void closePools(db).then(() => {
      if (redis) redis.disconnect();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
