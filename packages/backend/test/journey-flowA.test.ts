// Journey A (§1.10 Flow A): onboard → complete L1·M1 → pass its quiz → M2 unlocks;
// then replay the same offline mutations via /v1/sync/push and assert idempotency.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { createCongregation, createCellGroup, createModule, addQuestion } from "./helpers/factories.js";
import { IdentityService } from "../src/modules/identity/service.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";
import { SyncService } from "../src/modules/sync/service.js";
import { one } from "../src/db/db.js";

const COMPLETE_MUT = "aaaa0001-0000-4000-8000-000000000001";
const QUIZ_MUT = "aaaa0001-0000-4000-8000-000000000002";

describe("Journey A — module → quiz → unlock + idempotent replay (§1.10 Flow A)", () => {
  let userId: string;
  let m1: string, m2: string, q: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);

    // Onboard a real SSO user (provision → onboarding instantiates the L1 enrollment).
    const identity = new IdentityService(testPool(), testEnv());
    await identity.loginWithOAuth({ provider: "google", sub: "journeyA", fullName: "Journey A" });
    userId = (
      await one<{ user_id: string }>(
        testPool(),
        `SELECT user_id FROM oauth_identities WHERE provider='google' AND provider_sub='journeyA'`,
      )
    ).user_id;
    await identity.onboard(userId, {
      date_of_birth: "2000-01-01",
      phone_number: "+254700000000",
      cell_group_id: cell,
      is_baptized: false,
    });

    m1 = await createModule(1, 1);
    m2 = await createModule(1, 2);
    q = await addQuestion(m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("completes M1 + passes its quiz offline, unlocks M2, and replays idempotently", async () => {
    const sync = new SyncService(testPool());
    const mutations = [
      { mutation_id: COMPLETE_MUT, seq: 1, domain: "module_progress", op: "complete", payload: { module_id: m1 } },
      {
        mutation_id: QUIZ_MUT,
        seq: 2,
        domain: "quiz_attempts",
        op: "submit",
        payload: { module_id: m1, answers: [{ question_id: q, given_answer: "A" }] },
      },
    ];

    // First replay: both apply.
    const first = await sync.push(userId, { mutations });
    expect(first.results.map((r) => r.status)).toEqual(["applied", "applied"]);

    // Gating advanced: M2 is now unlocked for this member.
    const mod2 = (await new CurriculumService(testPool()).getModule(userId, m2)) as { locked: boolean };
    expect(mod2.locked).toBe(false);

    // Replay the identical queue: idempotent no-ops (§1.7).
    const second = await sync.push(userId, { mutations });
    expect(second.results.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);

    const attempts = await testPool().query("SELECT count(*)::int n FROM quiz_attempts");
    expect(attempts.rows[0].n).toBe(1); // not double-applied
  });
});
