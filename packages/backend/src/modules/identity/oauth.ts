// Federated sign-in (spec §5.3): OAuth 2.0 / OIDC with KingsChat (primary),
// Google, and Apple. The authorization-code exchange happens server-side; we
// validate the IdP token, then mint our own session — never trusting a
// client-asserted identity.
//
// Each provider is an adapter behind this interface so the rest of the system is
// provider-agnostic and tests can inject a fake. Providers with configured
// credentials get the generic OIDC adapter (oidc.ts); the rest resolve to a
// verifier that fails closed with a clear "not configured" error.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";
import { OidcVerifier } from "./oidc.js";

export interface OAuthProfile {
  provider: string;
  sub: string; // stable subject id from the IdP
  email?: string;
  fullName?: string;
}

/** Inputs to the server-side authorization-code exchange (§5.3). */
export interface VerifyParams {
  code: string;
  redirectUri?: string; // the client's registered redirect URI
  codeVerifier?: string; // PKCE verifier, when the client uses PKCE
}

export interface OAuthVerifier {
  /** Exchange an authorization code for a verified profile. */
  verify(params: VerifyParams): Promise<OAuthProfile>;
}

export type OAuthRegistry = Map<string, OAuthVerifier>;

class NotConfiguredVerifier implements OAuthVerifier {
  constructor(private readonly provider: string) {}
  verify(): Promise<OAuthProfile> {
    throw new ApiError(
      "UPSTREAM_UNAVAILABLE",
      `OAuth provider "${this.provider}" is not configured`,
    );
  }
}

interface ProviderCreds {
  issuer: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

/** Build a generic OIDC adapter when fully configured, else fail-closed. */
function adapterFor(provider: string, creds: ProviderCreds): OAuthVerifier {
  if (creds.issuer && creds.clientId && creds.clientSecret) {
    return new OidcVerifier({
      provider,
      issuer: creds.issuer,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
  }
  return new NotConfiguredVerifier(provider);
}

/**
 * Build the provider registry. Google and Apple use their well-known issuers;
 * KingsChat's issuer is configured (it is assumed OIDC-compatible — §0.3, C.1).
 */
export function buildOAuthRegistry(env: Env): OAuthRegistry {
  const reg: OAuthRegistry = new Map();
  reg.set(
    "kingschat",
    adapterFor("kingschat", {
      issuer: env.KINGSCHAT_OIDC_ISSUER,
      clientId: env.KINGSCHAT_OIDC_CLIENT_ID,
      clientSecret: env.KINGSCHAT_OIDC_SECRET,
    }),
  );
  reg.set(
    "google",
    adapterFor("google", {
      issuer: "https://accounts.google.com",
      clientId: env.OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: env.OAUTH_GOOGLE_SECRET,
    }),
  );
  reg.set(
    "apple",
    adapterFor("apple", {
      issuer: "https://appleid.apple.com",
      clientId: env.OAUTH_APPLE_CLIENT_ID,
      clientSecret: env.OAUTH_APPLE_SECRET,
    }),
  );
  return reg;
}
