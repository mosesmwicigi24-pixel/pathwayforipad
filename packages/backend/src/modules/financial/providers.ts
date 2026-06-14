// Mobile-money providers (Contract Matrix B7). M-Pesa / Airtel Money ride the
// SAME flow as Stripe: server initiates an STK-style push, the provider calls
// back a signed webhook, settlement + the balanced ledger happen ONLY on that
// verified callback (§5.6). Abstracted so the financial logic is testable with
// no network/secrets (CLAUDE.md); a real deployment binds Daraja / Airtel APIs
// here by env-named credentials.
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export type MobileMoneyKey = "mpesa" | "airtel";

export interface MobileMoneyCharge {
  amountMinor: number;
  currency: string;
  phoneNumber: string; // E.164 — where the STK push lands
  metadata: Record<string, string>;
}

export interface MobileMoneyCallback {
  event_id: string;
  ref: string; // the checkout reference we stored on the transaction
  status: "succeeded" | "failed";
}

export interface MobileMoneyProvider {
  readonly key: MobileMoneyKey;
  /** Send the STK push; returns the provider checkout reference. */
  initiate(input: MobileMoneyCharge): Promise<{ ref: string }>;
  /** Verify the callback signature and parse it, or throw on tamper. */
  verifyCallback(rawBody: Buffer | string, signature: string): MobileMoneyCallback;
}

/**
 * Deterministic HMAC-verified fake. Tests sign callback bodies with the same
 * shared secret the provider holds — the verification path is the real one.
 */
export class FakeMobileMoneyProvider implements MobileMoneyProvider {
  readonly initiated: MobileMoneyCharge[] = [];
  constructor(
    readonly key: MobileMoneyKey,
    private readonly secret = "test-mm-secret",
  ) {}

  async initiate(input: MobileMoneyCharge): Promise<{ ref: string }> {
    this.initiated.push(input);
    return { ref: `${this.key}_co_${this.initiated.length}` };
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  verifyCallback(rawBody: Buffer | string, signature: string): MobileMoneyCallback {
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = this.sign(body);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(/^[0-9a-f]+$/i.test(signature) ? signature : "00", "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError("VALIDATION_FAILED", `Invalid ${this.key} callback signature`);
    }
    const parsed = JSON.parse(body) as Partial<MobileMoneyCallback>;
    if (!parsed.event_id || !parsed.ref || !parsed.status) {
      throw new ApiError("VALIDATION_FAILED", "Malformed mobile-money callback");
    }
    return { event_id: parsed.event_id, ref: parsed.ref, status: parsed.status === "succeeded" ? "succeeded" : "failed" };
  }
}

/** E.164 / local → Daraja MSISDN (2547XXXXXXXX, no plus). */
function toMsisdn(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith("7")) d = `254${d}`;
  return d;
}

function yyyymmddhhmmss(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  env: "sandbox" | "production";
  txType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  callbackUrl: string;
}

/**
 * Real M-Pesa Daraja adapter (Lipa na M-Pesa Online). `initiate` sends the STK
 * push; the member confirms with their PIN on the handset. Daraja then POSTs an
 * unsigned `stkCallback` to our CallBackURL — settlement happens only on that
 * verified callback (§5.6). Authenticity rests on URL secrecy + Safaricom IP
 * allowlisting (Daraja does not HMAC-sign), so `verifyCallback` parses the
 * Daraja shape; idempotency is the unique CheckoutRequestID via processed_webhooks.
 */
export class DarajaMpesaProvider implements MobileMoneyProvider {
  readonly key = "mpesa" as const;
  private token?: { value: string; expiresAt: number };
  private readonly base: string;
  constructor(private readonly cfg: DarajaConfig) {
    this.base = cfg.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString("base64");
    const json = (await this.fetchJson(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      method: "GET",
      headers: { authorization: `Basic ${basic}` },
    })) as { access_token?: string; expires_in?: string };
    if (!json.access_token) throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa authorization failed");
    this.token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  async initiate(input: MobileMoneyCharge): Promise<{ ref: string }> {
    if (input.currency.toUpperCase() !== "KES") {
      throw new ApiError("VALIDATION_FAILED", "M-Pesa settles in KES only");
    }
    const token = await this.accessToken();
    const timestamp = yyyymmddhhmmss(new Date());
    const password = Buffer.from(`${this.cfg.shortcode}${this.cfg.passkey}${timestamp}`).toString("base64");
    const amount = Math.max(1, Math.round(input.amountMinor / 100)); // Daraja takes whole KES
    const account = (input.metadata.reference ?? input.metadata.fund ?? "NuruGiving").slice(0, 12);
    const json = (await this.fetchJson(`${this.base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: this.cfg.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: this.cfg.txType,
        Amount: amount,
        PartyA: toMsisdn(input.phoneNumber),
        PartyB: this.cfg.shortcode,
        PhoneNumber: toMsisdn(input.phoneNumber),
        CallBackURL: this.cfg.callbackUrl,
        AccountReference: account,
        TransactionDesc: "Giving",
      }),
    })) as { ResponseCode?: string; CheckoutRequestID?: string; errorMessage?: string };
    if (json.ResponseCode !== "0" || !json.CheckoutRequestID) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", json.errorMessage ?? "M-Pesa STK push was not accepted");
    }
    return { ref: json.CheckoutRequestID };
  }

  /** Parse Daraja's stkCallback. No signature to verify (Daraja sends none). */
  verifyCallback(rawBody: Buffer | string): MobileMoneyCallback {
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number } } };
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ApiError("VALIDATION_FAILED", "Malformed M-Pesa callback");
    }
    const cb = parsed.Body?.stkCallback;
    if (!cb?.CheckoutRequestID || cb.ResultCode === undefined) {
      throw new ApiError("VALIDATION_FAILED", "Malformed M-Pesa callback");
    }
    return {
      event_id: cb.CheckoutRequestID, // unique per push → idempotency key
      ref: cb.CheckoutRequestID,
      status: Number(cb.ResultCode) === 0 ? "succeeded" : "failed",
    };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

class NotConfiguredProvider implements MobileMoneyProvider {
  constructor(readonly key: MobileMoneyKey) {}
  initiate(): Promise<{ ref: string }> {
    throw new ApiError("UPSTREAM_UNAVAILABLE", `${this.key} payments are not configured`);
  }
  verifyCallback(): MobileMoneyCallback {
    throw new ApiError("UPSTREAM_UNAVAILABLE", `${this.key} payments are not configured`);
  }
}

export type MobileMoneyProviders = Record<MobileMoneyKey, MobileMoneyProvider>;

/** Env-named secrets only (§5.10); unconfigured providers degrade to clear 503s. */
export function buildMobileMoneyProviders(env: Env): MobileMoneyProviders {
  const darajaReady =
    env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_PASSKEY && env.MPESA_SHORTCODE && env.MPESA_CALLBACK_URL;
  return {
    mpesa: darajaReady
      ? new DarajaMpesaProvider({
          consumerKey: env.MPESA_CONSUMER_KEY!,
          consumerSecret: env.MPESA_CONSUMER_SECRET!,
          passkey: env.MPESA_PASSKEY!,
          shortcode: env.MPESA_SHORTCODE!,
          env: env.MPESA_ENV,
          txType: env.MPESA_TX_TYPE,
          callbackUrl: env.MPESA_CALLBACK_URL!,
        })
      : env.MPESA_CALLBACK_SECRET
        ? new FakeMobileMoneyProvider("mpesa", env.MPESA_CALLBACK_SECRET)
        : new NotConfiguredProvider("mpesa"),
    airtel: env.AIRTEL_CALLBACK_SECRET
      ? new FakeMobileMoneyProvider("airtel", env.AIRTEL_CALLBACK_SECRET)
      : new NotConfiguredProvider("airtel"),
  };
}
