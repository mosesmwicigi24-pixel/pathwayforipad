// Generic OIDC adapter (spec §5.3). Performs the server-side authorization-code
// exchange, then validates the returned id_token against the provider's JWKS
// before we trust any identity claim. Used for KingsChat (assumed OIDC-compatible
// per §0.3 / Appendix C.1), Google, and Apple.
//
// No third-party OIDC SDK: discovery and token exchange use Node 20's built-in
// fetch; id_token signature verification uses Node's crypto JWK import
// (createPublicKey) feeding the existing jsonwebtoken verifier. If KingsChat
// turns out to use a proprietary (non-OIDC) token, swap a KingsChat-specific
// verifier in at the registry (oauth.ts) — this generic path stays for the rest.
import jwt, { type Jwt, type JwtHeader } from "jsonwebtoken";
import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";
import { ApiError } from "../../http/errors.js";
import type { OAuthProfile, OAuthVerifier, VerifyParams } from "./oauth.js";

export interface OidcConfig {
  provider: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

interface Discovery {
  issuer: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h — OIDC metadata is stable
const JWKS_TTL_MS = 60 * 60 * 1000;

interface IdTokenClaims {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
}

/** One adapter instance per provider; caches discovery + JWKS across requests. */
export class OidcVerifier implements OAuthVerifier {
  private discovery: { value: Discovery; at: number } | null = null;
  private jwks: { keys: Jwk[]; at: number } | null = null;

  constructor(
    private readonly cfg: OidcConfig,
    // Injectable for tests; defaults to the global fetch (Node 20+).
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(params: VerifyParams): Promise<OAuthProfile> {
    const disco = await this.getDiscovery();
    const idToken = await this.exchangeCode(disco.token_endpoint, params);
    const claims = await this.verifyIdToken(disco, idToken);
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw new ApiError("AUTH_REQUIRED", `id_token missing subject (${this.cfg.provider})`);
    }
    return {
      provider: this.cfg.provider,
      sub: claims.sub,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      ...(typeof claims.name === "string" ? { fullName: claims.name } : {}),
    };
  }

  private async getDiscovery(): Promise<Discovery> {
    if (this.discovery && Date.now() - this.discovery.at < DISCOVERY_TTL_MS) {
      return this.discovery.value;
    }
    const url = `${this.cfg.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", `OIDC discovery failed for ${this.cfg.provider}`, {
        status: res.status,
      });
    }
    const value = (await res.json()) as Discovery;
    if (!value.token_endpoint || !value.jwks_uri) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", `OIDC discovery incomplete for ${this.cfg.provider}`);
    }
    this.discovery = { value, at: Date.now() };
    return value;
  }

  private async exchangeCode(tokenEndpoint: string, params: VerifyParams): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });
    if (params.redirectUri) body.set("redirect_uri", params.redirectUri);
    if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);

    const res = await this.fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      // A rejected code is the client's fault (invalid_grant); upstream faults are ours.
      if (res.status === 400 || res.status === 401) {
        throw new ApiError("AUTH_REQUIRED", `Authorization code rejected by ${this.cfg.provider}`);
      }
      throw new ApiError("UPSTREAM_UNAVAILABLE", `Token exchange failed for ${this.cfg.provider}`, {
        status: res.status,
      });
    }
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", `No id_token returned by ${this.cfg.provider}`);
    }
    return json.id_token;
  }

  private async verifyIdToken(disco: Discovery, idToken: string): Promise<IdTokenClaims> {
    const decoded: Jwt | null = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === "string") {
      throw new ApiError("AUTH_REQUIRED", `Malformed id_token (${this.cfg.provider})`);
    }
    const key = await this.getSigningKey(disco.jwks_uri, decoded.header);
    try {
      const payload = jwt.verify(idToken, key, {
        algorithms: ["RS256", "ES256"],
        issuer: disco.issuer || this.cfg.issuer,
        audience: this.cfg.clientId,
      });
      // With a non-HS algorithm and complete:false, payload is the claims object.
      return payload as IdTokenClaims;
    } catch {
      throw new ApiError("AUTH_REQUIRED", `id_token validation failed (${this.cfg.provider})`);
    }
  }

  private async getSigningKey(jwksUri: string, header: JwtHeader): Promise<KeyObject> {
    const kid = header.kid;
    let keys = await this.getJwks(jwksUri, false);
    let jwk = this.pick(keys, kid);
    if (!jwk && kid) {
      // Unknown kid → keys may have rotated; force one refresh before giving up.
      keys = await this.getJwks(jwksUri, true);
      jwk = this.pick(keys, kid);
    }
    if (!jwk) throw new ApiError("AUTH_REQUIRED", `No matching JWKS key (${this.cfg.provider})`);
    return createPublicKey({ key: jwk, format: "jwk" });
  }

  private pick(keys: Jwk[], kid: string | undefined): Jwk | undefined {
    if (kid) return keys.find((k) => k.kid === kid);
    return keys.find((k) => k.use === "sig" || k.kty === "RSA" || k.kty === "EC") ?? keys[0];
  }

  private async getJwks(jwksUri: string, force: boolean): Promise<Jwk[]> {
    if (!force && this.jwks && Date.now() - this.jwks.at < JWKS_TTL_MS) {
      return this.jwks.keys;
    }
    const res = await this.fetchImpl(jwksUri, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", `JWKS fetch failed for ${this.cfg.provider}`, {
        status: res.status,
      });
    }
    const json = (await res.json()) as { keys?: Jwk[] };
    const keys = json.keys ?? [];
    this.jwks = { keys, at: Date.now() };
    return keys;
  }
}
