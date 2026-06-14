// Financial service (spec §1.10 Flow C, §3.5, §5.6). Giving via Stripe (cards/
// wallets) and mobile money (M-Pesa/Airtel STK push, B7) behind the same
// intent → verified-webhook → balanced double-entry ledger flow, plus recurring
// giving schedules driven by a server-side scheduler. Money is always integer
// minor units + ISO currency — never floats — and never queued offline.
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { maybeOne, one, many, tx, audit, enqueueOutbox } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { PaymentGateway } from "./gateway.js";
import type { MobileMoneyKey, MobileMoneyProviders } from "./providers.js";
import type { PayPalGateway } from "./paypal.js";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export class FinancialService {
  constructor(
    private readonly pool: Pool,
    private readonly gateway: PaymentGateway,
    private readonly mobileMoney?: MobileMoneyProviders,
    private readonly paypal?: PayPalGateway,
  ) {}

  static readonly GivingIntent = z.object({
    fund: z.string().min(2).max(40), // validated against the funds table (data-driven, B7)
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    method: z.enum(["card", "mpesa", "airtel", "paypal"]).default("card"),
    phone_number: z.string().min(7).max(32).optional(), // mobile money; defaults to the profile phone
    idempotency_key: z.string().min(8).max(255).optional(),
  });

  private provider(key: MobileMoneyKey) {
    const p = this.mobileMoney?.[key];
    if (!p) throw new ApiError("UPSTREAM_UNAVAILABLE", `${key} payments are not configured`);
    return p;
  }

  private paypalGw(): PayPalGateway {
    if (!this.paypal) throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is not configured");
    return this.paypal;
  }

  /** Create a payment intent (card via Stripe, or an STK push via mobile money)
   *  and the matching pending transaction (§1.10 C). Settlement only ever
   *  happens on the verified webhook/callback — never here. */
  async createGivingIntent(
    userId: string,
    input: z.infer<typeof FinancialService.GivingIntent>,
    scheduleId?: string,
  ): Promise<Record<string, unknown>> {
    const key = input.idempotency_key ?? randomUUID();

    // Idempotent: the same client key returns the existing transaction.
    const existing = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `SELECT transaction_id, status FROM transactions WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) {
      return { transaction_id: existing.transaction_id, status: existing.status, idempotency_key: key, reused: true };
    }

    const fund = await maybeOne<{ fund_id: string }>(
      this.pool,
      `SELECT fund_id FROM funds WHERE code = $1 AND is_active`,
      [input.fund],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    const currency = input.currency.toUpperCase();

    if (input.method === "mpesa" || input.method === "airtel") {
      const phone =
        input.phone_number ??
        (await one<{ phone_number: string }>(this.pool, `SELECT phone_number FROM users WHERE user_id = $1`, [userId]))
          .phone_number;
      const charge = await this.provider(input.method).initiate({
        amountMinor: input.amount_minor,
        currency,
        phoneNumber: phone,
        metadata: { user_id: userId, fund: input.fund },
      });
      const txn = await one<{ transaction_id: string; status: string }>(
        this.pool,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id)
         VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8)
         RETURNING transaction_id, status`,
        [userId, fund.fund_id, input.amount_minor, currency, input.method, charge.ref, key, scheduleId ?? null],
      );
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor,
        currency,
        fund: input.fund,
        method: input.method,
      });
      return {
        transaction_id: txn.transaction_id,
        provider: input.method,
        provider_ref: charge.ref, // STK push sent — the member confirms on their phone
        status: txn.status,
        idempotency_key: key,
        reused: false,
      };
    }

    if (input.method === "paypal") {
      // PayPal can't transact KES — gifts settle in USD (amount treated as USD).
      const order = await this.paypalGw().createOrder({ amountMinor: input.amount_minor, reference: `${userId}:${input.fund}` });
      const txn = await one<{ transaction_id: string; status: string }>(
        this.pool,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id)
         VALUES ($1, $2, $3, 'USD', 'processing', 'paypal', $4, $5, $6)
         RETURNING transaction_id, status`,
        [userId, fund.fund_id, input.amount_minor, order.orderId, key, scheduleId ?? null],
      );
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor, currency: "USD", fund: input.fund, method: "paypal",
      });
      return {
        transaction_id: txn.transaction_id,
        provider: "paypal",
        provider_ref: order.orderId,
        approve_url: order.approveUrl, // open this; member approves on PayPal, then capture
        status: txn.status,
        idempotency_key: key,
        reused: false,
      };
    }

    const intent = await this.gateway.createIntent({
      amountMinor: input.amount_minor,
      currency,
      metadata: { user_id: userId, fund: input.fund },
    });

    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key, schedule_id)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7)
       RETURNING transaction_id, status`,
      [userId, fund.fund_id, input.amount_minor, currency, intent.id, key, scheduleId ?? null],
    );
    await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
      amount_minor: input.amount_minor,
      currency,
      fund: input.fund,
      method: "card",
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      idempotency_key: key,
      reused: false,
    };
  }

  /** Capture a PayPal order the member approved; settle the ledger on COMPLETED
   *  (§5.6 — money moves only here). Idempotent: an already-settled order is a no-op. */
  async capturePayPal(userId: string, orderId: string): Promise<{ status: string }> {
    const txn = await maybeOne<{ status: string }>(
      this.pool,
      `SELECT status FROM transactions WHERE provider = 'paypal' AND provider_ref = $1 AND user_id = $2`,
      [orderId, userId],
    );
    if (!txn) throw new ApiError("NOT_FOUND", "Order not found");
    if (txn.status === "succeeded" || txn.status === "settled") return { status: "succeeded" };
    const result = await this.paypalGw().captureOrder(orderId);
    if (result.status === "completed") {
      await tx(this.pool, async (c) => { await this.settle(c, { provider_ref: orderId }); });
      return { status: "succeeded" };
    }
    if (result.status === "failed") {
      await this.pool.query(`UPDATE transactions SET status = 'failed' WHERE provider_ref = $1 AND status <> 'succeeded'`, [orderId]);
      return { status: "failed" };
    }
    return { status: "processing" };
  }

  /**
   * Verified mobile-money callback (B7): HMAC check, idempotent dedupe in
   * processed_webhooks, then settlement by provider_ref — the same trust model
   * as the Stripe webhook (§3.5).
   */
  async handleMobileMoneyCallback(
    providerKey: MobileMoneyKey,
    rawBody: Buffer | string,
    signature: string,
  ): Promise<Record<string, unknown>> {
    const cb = this.provider(providerKey).verifyCallback(rawBody, signature);
    return tx(this.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO processed_webhooks (event_id, provider, payload_hash)
         VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [cb.event_id, providerKey, sha256(rawBody)],
      );
      if (ins.rowCount === 0) return { duplicate: true };

      if (cb.status === "succeeded") {
        await this.settle(c, { provider_ref: cb.ref });
      } else {
        await c.query(
          `UPDATE transactions SET status = 'failed' WHERE provider_ref = $1 AND status <> 'succeeded'`,
          [cb.ref],
        );
      }
      return { duplicate: false, status: cb.status };
    });
  }

  /**
   * Verify + process a Stripe webhook. HMAC check first (throws on tamper), then
   * a row-locked dedupe on event_id, then the ledger post — all in one tx so the
   * dedupe row and the double-entry commit together (§3.5).
   */
  async handleWebhook(rawBody: Buffer | string, signature: string): Promise<Record<string, unknown>> {
    const event = this.gateway.verifyWebhook(rawBody, signature);
    return tx(this.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO processed_webhooks (event_id, provider, payload_hash)
         VALUES ($1, 'Stripe', $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, sha256(rawBody)],
      );
      if (ins.rowCount === 0) return { duplicate: true }; // already processed — idempotent no-op

      if (event.type === "payment_intent.succeeded") {
        await this.settle(c, event.data.object);
      } else if (event.type === "payment_intent.payment_failed") {
        await c.query(
          `UPDATE transactions SET status = 'failed' WHERE stripe_payment_intent = $1 AND status <> 'succeeded'`,
          [String(event.data.object.id ?? "")],
        );
      }
      return { duplicate: false, type: event.type };
    });
  }

  /** Mark a transaction succeeded, post the double-entry, and grant a purchase
   *  if applicable. Looks up by Stripe intent id or mobile-money provider_ref;
   *  cash is debited to the provider's account (cash:stripe / cash:mpesa / …). */
  private async settle(c: PoolClient, intent: Record<string, unknown>): Promise<void> {
    const byProviderRef = typeof intent.provider_ref === "string";
    const ref = byProviderRef ? String(intent.provider_ref) : String(intent.id ?? "");
    const metadata = (intent.metadata as Record<string, unknown> | undefined) ?? {};
    const productId = typeof metadata.product_id === "string" ? metadata.product_id : null;

    const txn = await maybeOne<{
      transaction_id: string;
      user_id: string;
      amount_minor: string;
      currency: string;
      status: string;
      provider: string;
      fund_code: string | null;
    }>(
      c,
      `SELECT t.transaction_id, t.user_id, t.amount_minor, t.currency, t.status, t.provider, f.code AS fund_code
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE ${byProviderRef ? "t.provider_ref" : "t.stripe_payment_intent"} = $1 FOR UPDATE OF t`,
      [ref],
    );
    if (!txn || txn.status === "succeeded") return; // unknown intent or already settled

    await c.query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = $1`, [
      txn.transaction_id,
    ]);
    // Debit cash, credit the fund (giving) or media sales (purchase) — balanced (§5.6).
    const creditAccount = productId ? "sales:media" : `fund:${txn.fund_code ?? "general"}`;
    await c.query(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
       VALUES ($1, $5, 'debit', $2, $3), ($1, $4, 'credit', $2, $3)`,
      [txn.transaction_id, txn.amount_minor, txn.currency, creditAccount, `cash:${txn.provider}`],
    );

    // A product purchase grants access on settlement (§3.3).
    if (productId) {
      await c.query(
        `INSERT INTO purchases (user_id, product_id, transaction_id)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, product_id) DO NOTHING`,
        [txn.user_id, productId, txn.transaction_id],
      );
    }
    await enqueueOutbox(c, "giving.receipt", { transaction_id: txn.transaction_id, user_id: txn.user_id });
  }

  /** Active media catalogue (§3.3). */
  async listProducts(): Promise<unknown[]> {
    const rows = await many<{ price_minor: string }>(
      this.pool,
      `SELECT product_id, title, price_minor, currency FROM products WHERE is_active ORDER BY title`,
    );
    return rows.map((r) => ({ ...r, price_minor: Number(r.price_minor) }));
  }

  /** Start a media purchase: PaymentIntent + pending transaction; grant lands on the webhook. */
  async createPurchase(userId: string, productId: string): Promise<Record<string, unknown>> {
    const product = await maybeOne<{ price_minor: string; currency: string }>(
      this.pool,
      `SELECT price_minor, currency FROM products WHERE product_id = $1 AND is_active`,
      [productId],
    );
    if (!product) throw new ApiError("NOT_FOUND", "Product not found");

    const owned = await maybeOne(
      this.pool,
      `SELECT 1 FROM purchases WHERE user_id = $1 AND product_id = $2`,
      [userId, productId],
    );
    if (owned) throw new ApiError("CONFLICT", "Product already purchased");

    const key = `purchase:${userId}:${productId}`;
    const existing = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `SELECT transaction_id, status FROM transactions WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) return { transaction_id: existing.transaction_id, status: existing.status, reused: true };

    const currency = String(product.currency).toUpperCase();
    const intent = await this.gateway.createIntent({
      amountMinor: Number(product.price_minor),
      currency,
      metadata: { user_id: userId, product_id: productId, kind: "purchase" },
    });
    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key)
       VALUES ($1, NULL, $2, $3, 'processing', $4, $5)
       RETURNING transaction_id, status`,
      [userId, product.price_minor, currency, intent.id, key],
    );
    await audit(this.pool, userId, "purchase.intent_created", "products", productId, {
      transaction_id: txn.transaction_id,
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      reused: false,
    };
  }

  /** A member's giving history (§3.3). */
  async listGiving(userId: string): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund, t.created_at, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
  }

  // ---------------- Recurring giving (Contract Matrix B7) ----------------
  // The member manages the schedule ONLINE (money is never queued offline,
  // §3.6); the server-side scheduler is what creates each cycle's intent (§1.1).

  static readonly CreateSchedule = z.object({
    fund: z.string().min(2).max(40),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    frequency: z.enum(["weekly", "monthly"]),
    method: z.enum(["card", "mpesa", "airtel", "paypal"]).default("card"),
    idempotency_key: z.string().min(8).max(255).optional(),
  });

  private static nextRun(from: Date, frequency: "weekly" | "monthly"): Date {
    const next = new Date(from);
    if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  async createSchedule(
    userId: string,
    input: z.infer<typeof FinancialService.CreateSchedule>,
  ): Promise<Record<string, unknown>> {
    const key = input.idempotency_key ?? randomUUID();
    const existing = await maybeOne<{ schedule_id: string; status: string }>(
      this.pool,
      `SELECT schedule_id, status FROM giving_schedules WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) return { ...existing, reused: true };

    const fund = await maybeOne<{ fund_id: string }>(
      this.pool,
      `SELECT fund_id FROM funds WHERE code = $1 AND is_active`,
      [input.fund],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    // First charge on the next cycle boundary; give now if you want to give now.
    const firstRun = FinancialService.nextRun(new Date(), input.frequency);
    const row = await one<{ schedule_id: string; next_run_at: string }>(
      this.pool,
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING schedule_id, next_run_at`,
      [userId, fund.fund_id, input.amount_minor, input.currency.toUpperCase(), input.frequency, input.method, firstRun.toISOString(), key],
    );
    await audit(this.pool, userId, "giving.schedule_created", "giving_schedules", row.schedule_id, {
      fund: input.fund,
      amount_minor: input.amount_minor,
      frequency: input.frequency,
      method: input.method,
    });
    return { schedule_id: row.schedule_id, status: "active", next_run_at: row.next_run_at, reused: false };
  }

  async listSchedules(userId: string): Promise<{ data: unknown[] }> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT s.schedule_id, f.code AS fund, s.amount_minor, s.currency, s.frequency, s.method,
              s.status, s.next_run_at, s.last_run_at, s.created_at
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [userId],
    );
    return { data: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })) };
  }

  async cancelSchedule(userId: string, scheduleId: string): Promise<Record<string, unknown>> {
    const row = await maybeOne<{ schedule_id: string }>(
      this.pool,
      `UPDATE giving_schedules SET status = 'cancelled', cancelled_at = now()
        WHERE schedule_id = $1 AND user_id = $2 AND status = 'active'
        RETURNING schedule_id`,
      [scheduleId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Active schedule not found");
    await audit(this.pool, userId, "giving.schedule_cancelled", "giving_schedules", scheduleId, {});
    return { schedule_id: scheduleId, status: "cancelled" };
  }

  /**
   * Scheduler hook: charge every due active schedule. The cycle's intent key is
   * deterministic (schedule id + the due instant), so a crashed/overlapping run
   * can never double-charge; next_run_at advances from the DUE time, not "now",
   * so cadence never drifts.
   */
  async runDueSchedules(now: Date = new Date()): Promise<{ run: number; failed: number }> {
    const due = await many<{
      schedule_id: string;
      user_id: string;
      fund: string;
      amount_minor: string;
      currency: string;
      frequency: "weekly" | "monthly";
      method: "card" | "mpesa" | "airtel";
      next_run_at: string;
    }>(
      this.pool,
      `SELECT s.schedule_id, s.user_id, f.code AS fund, s.amount_minor, s.currency,
              s.frequency, s.method, s.next_run_at
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.status = 'active' AND s.next_run_at <= $1
        ORDER BY s.next_run_at`,
      [now.toISOString()],
    );
    let run = 0;
    let failed = 0;
    for (const s of due) {
      try {
        await this.createGivingIntent(
          s.user_id,
          {
            fund: s.fund,
            amount_minor: Number(s.amount_minor),
            currency: s.currency,
            method: s.method,
            idempotency_key: `sched:${s.schedule_id}:${s.next_run_at}`,
          },
          s.schedule_id,
        );
        await this.pool.query(
          `UPDATE giving_schedules SET last_run_at = $2, next_run_at = $3 WHERE schedule_id = $1`,
          [s.schedule_id, now.toISOString(), FinancialService.nextRun(new Date(s.next_run_at), s.frequency).toISOString()],
        );
        run += 1;
      } catch {
        failed += 1; // provider down etc. — schedule stays due; the next tick retries
      }
    }
    return { run, failed };
  }

  // ---------------- Admin finance reads (ERP, Contract Matrix B1) ----------------
  // Admin = view-only over the ledger; fund/financial CONFIG stays SuperAdmin (§5.4).

  /** Per-fund revenue: settled totals this month + all time (the "Fund Revenue" card). */
  async financeSummary(): Promise<Record<string, unknown>> {
    const funds = await many<Record<string, unknown>>(
      this.pool,
      `SELECT f.code, f.name, t.currency,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.status = 'succeeded'), 0)::bigint AS total_minor,
              COALESCE(sum(t.amount_minor) FILTER (
                WHERE t.status = 'succeeded' AND t.settled_at >= date_trunc('month', now())), 0)::bigint AS month_minor,
              count(t.transaction_id) FILTER (WHERE t.status = 'succeeded')::int AS gift_count
         FROM funds f
         LEFT JOIN transactions t ON t.fund_id = f.fund_id
        GROUP BY f.code, f.name, t.currency
        ORDER BY f.code`,
    );
    return {
      funds: funds.map((r) => ({ ...r, total_minor: Number(r.total_minor), month_minor: Number(r.month_minor) })),
    };
  }

  static readonly ListTransactions = z.object({
    fund: z.string().max(40).optional(),
    status: z.enum(["requires_action", "processing", "succeeded", "failed", "refunded"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().optional(), // keyset on created_at ISO
  });

  async listTransactions(
    q: z.infer<typeof FinancialService.ListTransactions>,
  ): Promise<{ data: unknown[]; next_cursor: string | null }> {
    const params: unknown[] = [];
    const where: string[] = ["TRUE"];
    if (q.fund) {
      params.push(q.fund);
      where.push(`f.code = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`t.status = $${params.length}::txn_status`);
    }
    if (q.before) {
      params.push(q.before);
      where.push(`t.created_at < $${params.length}`);
    }
    params.push(q.limit + 1);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, u.full_name, t.amount_minor, t.currency, t.status,
              f.code AS fund, t.created_at, t.settled_at,
              COALESCE(t.provider, CASE WHEN t.stripe_payment_intent IS NOT NULL THEN 'card' END) AS method
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN users u ON u.user_id = t.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
      next_cursor: hasMore && last ? String(last.created_at) : null,
    };
  }

  /** Recent double-entry ledger postings (always balanced, §5.6). */
  async listLedger(limit = 100): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT le.entry_id, le.transaction_id, le.account, le.side::text, le.amount_minor,
              le.currency, le.created_at
         FROM ledger_entries le
        ORDER BY le.created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
  }
}
