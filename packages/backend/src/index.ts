// API entry point. Boots config → DB pools (+ optional Redis) → HTTP server, with
// graceful shutdown. Background jobs run in the separate worker process
// (src/worker.ts), so the API stays stateless and fast (§1.1, §1.6).
import "dotenv/config";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { createPools, closePools } from "./db/pool.js";
import { createApp } from "./http/app.js";
import { buildRedis } from "./redis.js";

function main(): void {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL });
  const db = createPools(env);
  const redis = buildRedis(env);
  const app = createApp({ env, db, log, redis });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, region: env.AWS_REGION, env: env.NODE_ENV }, "nuru backend up");
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, "shutting down");
    server.close(() => {
      void closePools(db).then(() => {
        if (redis) redis.disconnect();
        process.exit(0);
      });
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
