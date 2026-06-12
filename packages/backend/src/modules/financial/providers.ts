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
  return {
    mpesa: env.MPESA_CALLBACK_SECRET
      ? new FakeMobileMoneyProvider("mpesa", env.MPESA_CALLBACK_SECRET) // TODO: real Daraja adapter
      : new NotConfiguredProvider("mpesa"),
    airtel: env.AIRTEL_CALLBACK_SECRET
      ? new FakeMobileMoneyProvider("airtel", env.AIRTEL_CALLBACK_SECRET)
      : new NotConfiguredProvider("airtel"),
  };
}
