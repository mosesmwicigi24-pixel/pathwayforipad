// Payments v2 (Contract Matrix B7): mobile money (M-Pesa/Airtel) behind the
// same intent → verified-callback → balanced-ledger flow as Stripe, plus
// recurring giving_schedules charged by the server-side scheduler. Guardrails
// unchanged: settlement ONLY on a verified callback; deterministic per-cycle
// idempotency keys make re-runs double-charge-proof.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import supertest from "supertest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { ApiError } from "../src/http/errors.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  public lastIntentId = "";
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    this.lastIntentId = `pi_${this.n}`;
    return { id: this.lastIntentId, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent {
    return JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as WebhookEvent;
  }
}

// One app for the HTTP webhook test, built FIRST so the singleton router gets
// providers configured from env (secret matches the fakes' default).
const env = { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret", AIRTEL_CALLBACK_SECRET: "test-mm-secret" };
const app = createApp({ env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });

let cong: string, user: string, userTok: string;
let gw: FakeGateway, mpesa: FakeMobileMoneyProvider, airtel: FakeMobileMoneyProvider;
let svc: FinancialService;

const signedBody = (p: FakeMobileMoneyProvider, payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  return { body, signature: p.sign(body) };
};

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "+254711222333" })).user_id;
  userTok = bearer({ sub: user, role: "Student", cong });
  gw = new FakeGateway();
  mpesa = new FakeMobileMoneyProvider("mpesa");
  airtel = new FakeMobileMoneyProvider("airtel");
  svc = new FinancialService(testPool(), gw, { mpesa, airtel });
});
afterAll(async () => {
  await closeTestPool();
});

describe("mobile money (same trust model as Stripe, §5.6)", () => {
  it("initiates an STK push and settles ONLY on the verified callback, ledger balanced on cash:mpesa", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "mission", // new B7 seed
      amount_minor: 20000,
      currency: "KES",
      method: "mpesa",
      idempotency_key: "give-mm-001",
    })) as { transaction_id: string; provider_ref: string; status: string };
    expect(intent.status).toBe("processing");
    expect(mpesa.initiated[0]!.phoneNumber).toBe("+254711222333"); // profile phone by default
    expect(intent).not.toHaveProperty("client_secret");

    // Tampered callback is rejected and settles nothing.
    const evil = signedBody(mpesa, { event_id: "evt_1", ref: intent.provider_ref, status: "succeeded" });
    await expect(svc.handleMobileMoneyCallback("mpesa", evil.body, "deadbeef")).rejects.toThrow(ApiError);

    // Verified callback settles + posts the balanced double-entry.
    const ok = signedBody(mpesa, { event_id: "evt_1", ref: intent.provider_ref, status: "succeeded" });
    const res = await svc.handleMobileMoneyCallback("mpesa", ok.body, ok.signature);
    expect(res.duplicate).toBe(false);

    const txn = await testPool().query(`SELECT status, provider FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(txn.rows[0]).toEqual({ status: "succeeded", provider: "mpesa" });
    const ledger = await testPool().query(
      `SELECT account, side::text, amount_minor::int AS amt FROM ledger_entries WHERE transaction_id=$1 ORDER BY side`,
      [intent.transaction_id],
    );
    expect(ledger.rows).toEqual([
      { account: "fund:mission", side: "credit", amt: 20000 },
      { account: "cash:mpesa", side: "debit", amt: 20000 },
    ]);

    // Replayed callback is an idempotent no-op (no second ledger post).
    const replay = await svc.handleMobileMoneyCallback("mpesa", ok.body, ok.signature);
    expect(replay.duplicate).toBe(true);
    const count = await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries`);
    expect(count.rows[0].n).toBe(2);
  });

  it("a failed callback marks the transaction failed without any ledger post", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "gift",
      amount_minor: 5000,
      currency: "KES",
      method: "airtel",
      phone_number: "+254700999888",
      idempotency_key: "give-mm-002",
    })) as { transaction_id: string; provider_ref: string };
    expect(airtel.initiated[0]!.phoneNumber).toBe("+254700999888"); // explicit phone wins

    const cb = signedBody(airtel, { event_id: "evt_2", ref: intent.provider_ref, status: "failed" });
    await svc.handleMobileMoneyCallback("airtel", cb.body, cb.signature);
    const txn = await testPool().query(`SELECT status FROM transactions WHERE transaction_id=$1`, [intent.transaction_id]);
    expect(txn.rows[0].status).toBe("failed");
    expect((await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries`)).rows[0].n).toBe(0);
  });

  it("HTTP callback route verifies the HMAC end-to-end", async () => {
    const created = await supertest(app)
      .post("/v1/giving/intents")
      .set({ Authorization: userTok })
      .send({ fund: "tithe", amount_minor: 1000, currency: "KES", method: "mpesa", idempotency_key: "give-mm-003" });
    expect(created.status).toBe(201);
    const ref = created.body.provider_ref;

    const http = new FakeMobileMoneyProvider("mpesa", "test-mm-secret");
    const ok = signedBody(http, { event_id: "evt_http", ref, status: "succeeded" });

    const bad = await supertest(app)
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("Content-Type", "application/json")
      .set("x-mm-signature", "deadbeef")
      .send(ok.body);
    expect(bad.status).toBe(400);

    const good = await supertest(app)
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("Content-Type", "application/json")
      .set("x-mm-signature", ok.signature)
      .send(ok.body);
    expect(good.status).toBe(200);
    const txn = await testPool().query(`SELECT status FROM transactions WHERE provider_ref=$1`, [ref]);
    expect(txn.rows[0].status).toBe("succeeded");
  });
});

describe("recurring giving schedules (server-charged, §1.1)", () => {
  it("charges due schedules with deterministic keys — re-runs never double-charge", async () => {
    const created = (await svc.createSchedule(user, {
      fund: "tithe",
      amount_minor: 10000,
      currency: "KES",
      frequency: "weekly",
      method: "card",
      idempotency_key: "sched-001",
    })) as { schedule_id: string; next_run_at: string };

    // Idempotent create.
    const again = (await svc.createSchedule(user, {
      fund: "tithe",
      amount_minor: 10000,
      currency: "KES",
      frequency: "weekly",
      idempotency_key: "sched-001",
    })) as { schedule_id: string; reused: boolean };
    expect(again.reused).toBe(true);
    expect(again.schedule_id).toBe(created.schedule_id);

    // Not due yet → nothing runs.
    expect((await svc.runDueSchedules(new Date())).run).toBe(0);

    // Backdate the due time → one charge, linked to the schedule, cadence +7d from DUE.
    const due = new Date(Date.now() - 3600_000);
    await testPool().query(`UPDATE giving_schedules SET next_run_at=$2 WHERE schedule_id=$1`, [
      created.schedule_id,
      due.toISOString(),
    ]);
    expect((await svc.runDueSchedules(new Date())).run).toBe(1);

    const txns = await testPool().query(
      `SELECT schedule_id, status, amount_minor::int AS amt FROM transactions WHERE schedule_id=$1`,
      [created.schedule_id],
    );
    expect(txns.rows).toHaveLength(1);
    expect(txns.rows[0].amt).toBe(10000);

    const sched = await testPool().query(`SELECT next_run_at FROM giving_schedules WHERE schedule_id=$1`, [
      created.schedule_id,
    ]);
    const expected = new Date(due);
    expected.setUTCDate(expected.getUTCDate() + 7);
    expect(new Date(sched.rows[0].next_run_at).toISOString()).toBe(expected.toISOString());

    // Crash simulation: rewind next_run_at to the SAME due instant and re-run —
    // the deterministic key makes it a reused no-op, not a second charge.
    await testPool().query(`UPDATE giving_schedules SET next_run_at=$2 WHERE schedule_id=$1`, [
      created.schedule_id,
      due.toISOString(),
    ]);
    expect((await svc.runDueSchedules(new Date())).run).toBe(1); // reused intent, still advances
    const after = await testPool().query(`SELECT count(*)::int AS n FROM transactions WHERE schedule_id=$1`, [
      created.schedule_id,
    ]);
    expect(after.rows[0].n).toBe(1);
  });

  it("cancelled schedules stop charging; cancel is owner-scoped and one-shot", async () => {
    const created = (await svc.createSchedule(user, {
      fund: "gift",
      amount_minor: 2500,
      currency: "KES",
      frequency: "monthly",
      method: "mpesa",
      idempotency_key: "sched-002",
    })) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET next_run_at=now() - interval '1 hour'`);

    await svc.cancelSchedule(user, created.schedule_id);
    expect((await svc.runDueSchedules(new Date())).run).toBe(0);
    await expect(svc.cancelSchedule(user, created.schedule_id)).rejects.toThrow("Active schedule not found");

    const mine = (await svc.listSchedules(user)) as { data: Array<{ status: string }> };
    expect(mine.data[0]!.status).toBe("cancelled");
  });

  it("provider outages leave the schedule due — the next tick retries", async () => {
    // No mobile-money providers wired at all → initiate throws.
    const lonely = new FinancialService(testPool(), gw);
    await lonely.createSchedule(user, {
      fund: "tithe",
      amount_minor: 700,
      currency: "KES",
      frequency: "weekly",
      method: "mpesa",
      idempotency_key: "sched-003",
    });
    await testPool().query(`UPDATE giving_schedules SET next_run_at=now() - interval '1 hour'`);
    const result = await lonely.runDueSchedules(new Date());
    expect(result).toEqual({ run: 0, failed: 1 });
    const sched = await testPool().query(`SELECT next_run_at < now() AS still_due FROM giving_schedules`);
    expect(sched.rows[0].still_due).toBe(true); // untouched — will retry
  });
});
