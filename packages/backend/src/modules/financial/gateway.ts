// Payment gateway abstraction (spec §3.5, §5.6). Card data never touches our
// servers (Stripe Elements tokenizes client-side → PCI SAQ-A); we only create
// PaymentIntents and verify signed webhooks. Behind an interface so the financial
// logic is testable without Stripe and degrades to a clear 503 when unconfigured.
import Stripe from "stripe";
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface PaymentIntentResult {
  id: string;
  client_secret: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface PaymentGateway {
  createIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntentResult>;
  /** Verify the HMAC signature and return the event, or throw on tamper. */
  verifyWebhook(rawBody: Buffer | string, signature: string): WebhookEvent;
}

class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;
  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" } as Stripe.StripeConfig);
  }

  async createIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });
    return { id: intent.id, client_secret: intent.client_secret ?? "" };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string): WebhookEvent {
    if (!this.webhookSecret) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", "Stripe webhook secret not configured");
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new ApiError("VALIDATION_FAILED", "Invalid Stripe webhook signature");
    }
    return {
      id: event.id,
      type: event.type,
      data: { object: event.data.object as unknown as Record<string, unknown> },
    };
  }
}

class NotConfiguredGateway implements PaymentGateway {
  createIntent(): Promise<PaymentIntentResult> {
    throw new ApiError("UPSTREAM_UNAVAILABLE", "Payments are not configured");
  }
  verifyWebhook(): WebhookEvent {
    throw new ApiError("UPSTREAM_UNAVAILABLE", "Payments are not configured");
  }
}

export function buildPaymentGateway(env: Env): PaymentGateway {
  if (env.STRIPE_SECRET_KEY) {
    return new StripeGateway(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET ?? "");
  }
  return new NotConfiguredGateway();
}
