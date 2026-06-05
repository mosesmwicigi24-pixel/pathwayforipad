// Federated sign-in (spec §5.3): OAuth 2.0 / OIDC with KingsChat (primary),
// Google, and Apple. The authorization-code exchange happens server-side; we
// validate the IdP token, then mint our own session — never trusting a
// client-asserted identity.
//
// Each provider is an adapter behind this interface so the rest of the system is
// provider-agnostic and tests can inject a fake. The real KingsChat/Google/Apple
// adapters (token exchange + signature/issuer validation) are wired here as the
// IdP credentials are provisioned; until then they throw a clear "not configured"
// error rather than a silent stub.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface OAuthProfile {
  provider: string;
  sub: string; // stable subject id from the IdP
  email?: string;
  fullName?: string;
}

export interface OAuthVerifier {
  /** Exchange an authorization code for a verified profile. */
  verify(code: string): Promise<OAuthProfile>;
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

/** Build the provider registry. Real adapters slot in here keyed by provider. */
export function buildOAuthRegistry(_env: Env): OAuthRegistry {
  const reg: OAuthRegistry = new Map();
  // TODO: replace with real adapters as IdP credentials land. Each validates the
  // code → token exchange and the token's signature/issuer/audience before
  // returning an OAuthProfile.
  reg.set("kingschat", new NotConfiguredVerifier("kingschat"));
  reg.set("google", new NotConfiguredVerifier("google"));
  reg.set("apple", new NotConfiguredVerifier("apple"));
  return reg;
}
