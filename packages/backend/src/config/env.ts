// Environment configuration (spec Appendix B.1). Validated once at boot; the rest
// of the app imports the typed `env` object. Secrets are read from the process
// environment only — never hard-coded (§5.10).
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  AWS_REGION: z.string().default("af-south-1"),

  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  JWT_SIGNING_KEY: z.string().min(1),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  KINGSCHAT_OIDC_ISSUER: z.string().optional(),
  KINGSCHAT_OIDC_CLIENT_ID: z.string().optional(),
  KINGSCHAT_OIDC_SECRET: z.string().optional(),

  // Secondary OAuth/OIDC providers (Appendix B.1). Issuers are well-known
  // (Google: accounts.google.com, Apple: appleid.apple.com), so only the client
  // credentials are configured here. Apple's secret is the operator-generated,
  // periodically-rotated ES256 client-secret JWT (stored by name, never built here).
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_SECRET: z.string().optional(),
  OAUTH_APPLE_CLIENT_ID: z.string().optional(),
  OAUTH_APPLE_SECRET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  YOUVERSION_APP_KEY: z.string().optional(),
  YOUVERSION_LANGUAGE_RANGES: z.string().default("en"),

  CLOUDINARY_URL: z.string().optional(),
  CERT_SIGNING_KEY: z.string().optional(),
  PUSH_PROVIDER_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse and cache the environment. Throws a readable error on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
