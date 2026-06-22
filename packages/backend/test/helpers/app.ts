// Build the real Express app against the embedded test Postgres, plus helpers to
// mint a valid access token for a user so authenticated routes can be exercised
// without going through the (intentionally not-configured) OAuth providers.
import { pino } from "pino";
import supertest from "supertest";
import type { Env } from "../../src/config/env.js";
import { createApp } from "../../src/http/app.js";
import { signAccessToken } from "../../src/modules/identity/tokens.js";
import type { AccessClaims } from "../../src/modules/identity/tokens.js";
import { testPool } from "./db.js";

export function testEnv(): Env {
  return {
    NODE_ENV: "test",
    PORT: 0,
    AWS_REGION: "af-south-1",
    DATABASE_URL: "postgres://nuru:nuru@localhost:55432/nuru_test",
    JWT_SIGNING_KEY: "test-signing-key",
    JWT_ACCESS_TTL: 900,
    REFRESH_TTL: 2_592_000,
    YOUVERSION_LANGUAGE_RANGES: "en",
    LOG_LEVEL: "silent" as Env["LOG_LEVEL"],
    MEDIA_STORAGE_DIR: "/tmp/nuru-media-test",
    MEDIA_PUBLIC_BASE_URL: "http://localhost/media",
    MEDIA_MAX_UPLOAD_BYTES: 2_147_483_648,
  } as Env;
}

export function makeApp() {
  const env = testEnv();
  const pool = testPool();
  const ctx = { env, db: { primary: pool, replica: pool }, log: pino({ level: "silent" }) };
  return createApp(ctx);
}

export function agent() {
  return supertest(makeApp());
}

export function bearer(claims: AccessClaims): string {
  return `Bearer ${signAccessToken(testEnv(), claims)}`;
}
