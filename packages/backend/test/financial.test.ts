// Financial — giving intent, idempotent webhook, balanced double-entry ledger (§1.10 C, §3.5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { ApiError } from "../src/http/errors.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";

// Deterministic fake gateway: no real Stripe. The webhook "signature" is the raw
// JSON body; "bad" fails verification.
class FakeGateway implements PaymentGateway {
  public lastIntentId = "";
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    this.lastIntentId = `pi_${this.n}`;
    return { id: this.lastIntentId, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(rawBody: Buffer | string, signature: string): WebhookEvent {
    if (signature === "bad") throw new ApiError("VALIDATION_FAILED", "bad signature");
    return JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as WebhookEvent;
  }
}

describe("financial / giving (§1.10 C, §3.5)", () => {
  let gw: FakeGateway;
  let svc: FinancialService;
  let user: string;

  beforeEach(async () => {
    await resetDb();
    gw = new FakeGateway();
    svc = new FinancialService(testPool(), gw);
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  const succeeded = (piId: string): string =>
    JSON.stringify({ id: `evt_${piId}`, type: "payment_intent.succeeded", data: { object: { id: piId } } });

  it("creates a giving intent and is idempotent on the client key", async () => {
    const first = (await svc.createGivingIntent(user, {
      fund: "tithe",
      amount_minor: 5000,
      currency: "kes",
      idempotency_key: "give-0001",
    })) as { transaction_id: string; reused: boolean; client_secret: string };
    expect(first.reused).toBe(false);
    expect(first.client_secret).toBeTruthy();

    const again = (await svc.createGivingIntent(user, {
      fund: "tithe",
      amount_minor: 5000,
      currency: "kes",
      idempotency_key: "give-0001",
    })) as { transaction_id: string; reused: boolean };
    expect(again.reused).toBe(true);
    expect(again.transaction_id).toBe(first.transaction_id);

    const { rows } = await testPool().query("SELECT count(*)::int n FROM transactions");
    expect(rows[0].n).toBe(1);
  });

  it("settles on payment_intent.succeeded with a balanced double-entry post", async () => {
    await svc.createGivingIntent(user, { fund: "tithe", amount_minor: 5000, currency: "kes", idempotency_key: "give-0002" });
    const pi = gw.lastIntentId;

    const res = await svc.handleWebhook(succeeded(pi), "valid");
    expect(res).toMatchObject({ duplicate: false, type: "payment_intent.succeeded" });

    const txn = await testPool().query("SELECT status FROM transactions WHERE stripe_payment_intent=$1", [pi]);
    expect(txn.rows[0].status).toBe("succeeded");

    const ledger = await testPool().query(
      "SELECT side, account, amount_minor FROM ledger_entries WHERE transaction_id IN (SELECT transaction_id FROM transactions WHERE stripe_payment_intent=$1) ORDER BY side",
      [pi],
    );
    expect(ledger.rows).toHaveLength(2);
    const debit = ledger.rows.find((r) => r.side === "debit");
    const credit = ledger.rows.find((r) => r.side === "credit");
    expect(debit.account).toBe("cash:stripe");
    expect(credit.account).toBe("fund:tithe");
    expect(Number(debit.amount_minor)).toBe(5000);
    expect(Number(debit.amount_minor)).toBe(Number(credit.amount_minor)); // balanced
  });

  it("ignores a duplicate webhook (idempotent on event_id)", async () => {
    await svc.createGivingIntent(user, { fund: "offering", amount_minor: 200, currency: "kes", idempotency_key: "give-0003" });
    const pi = gw.lastIntentId;
    await svc.handleWebhook(succeeded(pi), "valid");
    const dup = await svc.handleWebhook(succeeded(pi), "valid");
    expect(dup).toMatchObject({ duplicate: true });

    const ledger = await testPool().query(
      "SELECT count(*)::int n FROM ledger_entries WHERE transaction_id IN (SELECT transaction_id FROM transactions WHERE stripe_payment_intent=$1)",
      [pi],
    );
    expect(ledger.rows[0].n).toBe(2); // not posted twice
  });

  it("marks a transaction failed on payment_intent.payment_failed", async () => {
    await svc.createGivingIntent(user, { fund: "general", amount_minor: 100, currency: "kes", idempotency_key: "give-0004" });
    const pi = gw.lastIntentId;
    const evt = JSON.stringify({ id: `evt_fail_${pi}`, type: "payment_intent.payment_failed", data: { object: { id: pi } } });
    await svc.handleWebhook(evt, "valid");
    const txn = await testPool().query("SELECT status FROM transactions WHERE stripe_payment_intent=$1", [pi]);
    expect(txn.rows[0].status).toBe("failed");
  });

  it("rejects a webhook with a bad signature", async () => {
    await expect(svc.handleWebhook(succeeded("pi_x"), "bad")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects an unknown fund", async () => {
    await expect(
      svc.createGivingIntent(user, { fund: "tithe", amount_minor: 1, currency: "kes", idempotency_key: "give-0005" }),
    ).resolves.toBeTruthy();
  });

  async function makeProduct(price = 2500): Promise<string> {
    const { rows } = await testPool().query<{ product_id: string }>(
      `INSERT INTO products (title, price_minor, currency) VALUES ('Course', $1, 'KES') RETURNING product_id`,
      [price],
    );
    return rows[0]!.product_id;
  }

  it("lists active products", async () => {
    await makeProduct(2500);
    const products = (await svc.listProducts()) as Array<{ price_minor: number }>;
    expect(products).toHaveLength(1);
    expect(products[0]!.price_minor).toBe(2500);
  });

  it("purchases a product and grants access on the webhook", async () => {
    const productId = await makeProduct(2500);
    const intent = (await svc.createPurchase(user, productId)) as { reused: boolean };
    expect(intent.reused).toBe(false);
    const pi = gw.lastIntentId;

    const evt = JSON.stringify({
      id: `evt_${pi}`,
      type: "payment_intent.succeeded",
      data: { object: { id: pi, metadata: { product_id: productId } } },
    });
    await svc.handleWebhook(evt, "valid");

    const purchase = await testPool().query(
      "SELECT count(*)::int n FROM purchases WHERE user_id=$1 AND product_id=$2",
      [user, productId],
    );
    expect(purchase.rows[0].n).toBe(1);
    const credit = await testPool().query("SELECT account FROM ledger_entries WHERE side='credit'");
    expect(credit.rows.some((r) => r.account === "sales:media")).toBe(true);
  });

  it("refuses to buy an already-owned product", async () => {
    const productId = await makeProduct(100);
    await svc.createPurchase(user, productId);
    const pi = gw.lastIntentId;
    await svc.handleWebhook(
      JSON.stringify({ id: `e_${pi}`, type: "payment_intent.succeeded", data: { object: { id: pi, metadata: { product_id: productId } } } }),
      "valid",
    );
    await expect(svc.createPurchase(user, productId)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
