// PayPal Orders v2 gateway (giving). PayPal cannot transact KES, so PayPal gifts
// settle in USD — the entered amount is treated as USD (per product decision).
// Two-step, like a redirect checkout: createOrder → member approves on PayPal →
// captureOrder; settlement of our ledger happens only after a COMPLETED capture
// (§5.6). Behind an interface so the financial logic is testable with no
// network/secrets (FakePayPalGateway); a real deployment binds creds by env name.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface PayPalOrder {
  orderId: string;
  approveUrl: string;
}

export interface PayPalGateway {
  /** Create a CAPTURE order; returns the order id + the approval URL to open. */
  createOrder(input: { amountMinor: number; reference: string }): Promise<PayPalOrder>;
  /** Capture an approved order; "completed" means the money moved. */
  captureOrder(orderId: string): Promise<{ status: "completed" | "pending" | "failed" }>;
}

class LivePayPalGateway implements PayPalGateway {
  private token?: { value: string; expiresAt: number };
  private readonly base: string;
  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    env: "sandbox" | "live",
    private readonly returnUrl: string,
  ) {
    this.base = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const json = (await this.fetchJson(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    })) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal authorization failed");
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  async createOrder(input: { amountMinor: number; reference: string }): Promise<PayPalOrder> {
    const token = await this.accessToken();
    const value = (input.amountMinor / 100).toFixed(2);
    const json = (await this.fetchJson(`${this.base}/v2/checkout/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value }, custom_id: input.reference, description: "Nuru Place giving" }],
        application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: this.returnUrl, cancel_url: this.returnUrl },
      }),
    })) as { id?: string; links?: Array<{ rel: string; href: string }> };
    const approve = json.links?.find((l) => l.rel === "approve")?.href;
    if (!json.id || !approve) throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal order was not created");
    return { orderId: json.id, approveUrl: approve };
  }

  async captureOrder(orderId: string): Promise<{ status: "completed" | "pending" | "failed" }> {
    const token = await this.accessToken();
    const json = (await this.fetchJson(`${this.base}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    })) as { status?: string };
    if (json.status === "COMPLETED") return { status: "completed" };
    if (json.status === "PENDING" || json.status === "APPROVED") return { status: "pending" };
    return { status: "failed" };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is unavailable right now");
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Deterministic fake — exercises the create→capture→settle path with no network. */
export class FakePayPalGateway implements PayPalGateway {
  readonly created: Array<{ amountMinor: number; reference: string }> = [];
  constructor(private readonly captureStatus: "completed" | "pending" | "failed" = "completed") {}
  async createOrder(input: { amountMinor: number; reference: string }): Promise<PayPalOrder> {
    this.created.push(input);
    const orderId = `PP_ORDER_${this.created.length}`;
    return { orderId, approveUrl: `https://sandbox.paypal.com/checkoutnow?token=${orderId}` };
  }
  async captureOrder(): Promise<{ status: "completed" | "pending" | "failed" }> {
    return { status: this.captureStatus };
  }
}

class NotConfiguredPayPalGateway implements PayPalGateway {
  createOrder(): Promise<PayPalOrder> {
    throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is not configured");
  }
  captureOrder(): Promise<{ status: "completed" | "pending" | "failed" }> {
    throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is not configured");
  }
}

export function buildPayPalGateway(env: Env): PayPalGateway {
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) {
    return new LivePayPalGateway(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, env.PAYPAL_ENV, env.PAYPAL_RETURN_URL);
  }
  return new NotConfiguredPayPalGateway();
}
