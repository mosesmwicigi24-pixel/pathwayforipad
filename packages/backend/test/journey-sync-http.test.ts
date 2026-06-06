// The mobile offline loop, end-to-end over real HTTP against the embedded Postgres:
// dev-login → push offline (complete + quiz) → pull delta → idempotent replay (§1.7, §3.6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent } from "./helpers/app.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule, addQuestion } from "./helpers/factories.js";

const MC = "cccc0001-0000-4000-8000-000000000001";
const MQ = "cccc0001-0000-4000-8000-000000000002";

describe("mobile sync loop over HTTP (§1.7, §3.6)", () => {
  let email: string, m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    email = "student1@dev.local";
    const student = (await createUser({ congregationId: cong, cellGroupId: cell, email })).user_id;
    await createEnrollment(student, 1);
    m1 = await createModule(1, 1);
    await createModule(1, 2);
    q = await addQuestion(m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("dev-login → offline push → pull → idempotent replay", async () => {
    const login = await agent().post("/v1/auth/dev-login").send({ email }).expect(200);
    const token = login.body.access_token as string;
    const bearer = `Bearer ${token}`;
    const mutations = [
      { mutation_id: MC, seq: 1, domain: "module_progress", op: "complete", payload: { module_id: m1 } },
      {
        mutation_id: MQ,
        seq: 2,
        domain: "quiz_attempts",
        op: "submit",
        payload: { module_id: m1, answers: [{ question_id: q, given_answer: "A" }] },
      },
    ];

    const push1 = await agent().post("/v1/sync/push").set("Authorization", bearer).send({ mutations }).expect(200);
    expect(push1.body.results.map((r: { status: string }) => r.status)).toEqual(["applied", "applied"]);

    const pull = await agent().post("/v1/sync/pull").set("Authorization", bearer).send({ cursors: {} }).expect(200);
    expect(pull.body.changes.module_progress?.length).toBeGreaterThanOrEqual(1);
    expect(pull.body.cursors.module_progress).toBeGreaterThan(0);

    const push2 = await agent().post("/v1/sync/push").set("Authorization", bearer).send({ mutations }).expect(200);
    expect(push2.body.results.map((r: { status: string }) => r.status)).toEqual(["duplicate", "duplicate"]);
  });
});
