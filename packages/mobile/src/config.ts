// API base-URL resolution (spec §1.3). Order of precedence:
//   1. An explicit env override — EXPO_PUBLIC_API_URL / API_URL / NURU_API_URL.
//   2. Release builds → the production API (public HTTPS, works on any network).
//   3. Dev builds → the dev machine: Android emulator reaches the host at
//      10.0.2.2; the iOS simulator uses localhost.
// This module is pure (no react-native import) so it stays import-safe in the
// vitest runner; App.tsx passes the runtime Platform.OS in.
const API_PORT = 8080;
const API_PREFIX = "/v1";
const PROD_API_URL = "https://pathway.nuruplace.org/v1";

function envUrl(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env ? env.EXPO_PUBLIC_API_URL || env.API_URL || env.NURU_API_URL : "";
  return (raw || "").trim();
}

/** Resolve the backend base URL. Pass Platform.OS for the right emulator host. */
export function apiBaseUrl(platformOS?: string): string {
  const override = envUrl();
  if (override) return override.replace(/\/+$/, "");
  // Release/standalone builds (and anything not running under the Metro dev
  // server) talk to production over HTTPS. __DEV__ is injected by RN at build
  // time; it's undefined under vitest, so default those to production too.
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  if (!isDev) return PROD_API_URL;
  const host = platformOS === "android" ? "10.0.2.2" : "localhost";
  return `http://${host}:${API_PORT}${API_PREFIX}`;
}
