// Shared application context handed to every module's register() hook. Holds the
// cross-cutting singletons (config, DB pools, logger) so modules stay stateless
// and hold no connections of their own (§1.1 "Stateless services, stateful data").
import type { Logger } from "pino";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { DbPools } from "../db/pool.js";

export interface AppContext {
  env: Env;
  db: DbPools;
  log: Logger;
  // Present when REDIS_URL is configured (sessions/cache/rate-limit, §1.6). Optional
  // so tests and Redis-less dev still build a working app.
  redis?: Redis | undefined;
}
