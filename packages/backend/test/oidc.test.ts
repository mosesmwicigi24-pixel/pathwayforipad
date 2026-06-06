// Hermetic test for the generic OIDC adapter (§5.3). Generates a real RSA key,
// signs an id_token, and serves discovery/token/JWKS through an injected fetch —
// exercising the full server-side code exchange + JWKS signature validation with
// no network and no third-party OIDC SDK.
import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { OidcVerifier } from "../src/modules/identity/oidc.js";

const ISSUER = "https://idp.test";
const CLIENT_ID = "client-123";
const KID = "test-key-1";

let privatePem: string;
let jwk: Record<string, unknown>;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** A fetch stub whose /token behaviour the test can swap. */
function makeFetch(tokenResponder: () => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return jsonResponse({
        issuer: ISSUER,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url === `${ISSUER}/token`) return tokenResponder();
    if (url === `${ISSUER}/jwks`) return jsonResponse({ keys: [jwk] });
    return jsonResponse({}, false, 404);
  }) as typeof fetch;
}

function signIdToken(overrides: { audience?: string } = {}): string {
  return jwt.sign({ sub: "idp-sub-1", email: "ada@example.com", name: "Ada Lovelace" }, privatePem, {
    algorithm: "RS256",
    keyid: KID,
    issuer: ISSUER,
    audience: overrides.audience ?? CLIENT_ID,
    expiresIn: "5m",
  });
}

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  jwk = {
    ...((publicKey as KeyObject).export({ format: "jwk" }) as Record<string, unknown>),
    kid: KID,
    use: "sig",
    alg: "RS256",
  };
});

describe("OIDC adapter (§5.3)", () => {
  const cfg = { provider: "google", issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "shh" };

  it("exchanges a code and returns the verified profile from the id_token", async () => {
    const v = new OidcVerifier(cfg, makeFetch(() => jsonResponse({ id_token: signIdToken() })));
    const profile = await v.verify({ code: "auth-code", redirectUri: "https://app/cb" });
    expect(profile).toEqual({
      provider: "google",
      sub: "idp-sub-1",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
    });
  });

  it("rejects an id_token signed for a different audience", async () => {
    const v = new OidcVerifier(
      cfg,
      makeFetch(() => jsonResponse({ id_token: signIdToken({ audience: "someone-else" }) })),
    );
    await expect(v.verify({ code: "auth-code" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("treats a rejected authorization code (HTTP 400) as AUTH_REQUIRED", async () => {
    const v = new OidcVerifier(cfg, makeFetch(() => jsonResponse({ error: "invalid_grant" }, false, 400)));
    await expect(v.verify({ code: "bad" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("surfaces an upstream token-endpoint fault as UPSTREAM_UNAVAILABLE", async () => {
    const v = new OidcVerifier(cfg, makeFetch(() => jsonResponse({}, false, 503)));
    await expect(v.verify({ code: "x" })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
