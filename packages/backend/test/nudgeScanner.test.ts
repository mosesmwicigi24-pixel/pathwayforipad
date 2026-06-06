// Inactivity nudge scanner — schedules re-engagement for stalling members, paced
// by a cooldown (§1.5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment } from "./helpers/factories.js";
import { EngagementService } from "../src/modules/engagement/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { NudgeScanner } from "../src/workers/nudgeScanner.js";

describe("nudge scanner (§1.5)", () => {
  let user: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    user = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(user, 1);
    // No interactions/attendance ⇒ Eᵢ = 0 ⇒ band at_risk.
    await new EngagementService(testPool()).recomputeAll();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("schedules a re-engagement nudge for an at-risk member, once per cooldown", async () => {
    const scanner = new NudgeScanner(testPool(), new NotificationService(testPool()));
    const first = await scanner.scanOnce();
    expect(first.nudged).toBe(1);

    const notif = await testPool().query(
      "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND template='reengage'",
      [user],
    );
    expect(notif.rows[0].n).toBe(1);

    // Re-running within the cooldown does not pile on more nudges.
    const second = await scanner.scanOnce();
    expect(second.nudged).toBe(0);
  });

  it("does not nudge a thriving member", async () => {
    // Bump this member to thriving directly, then scan.
    await testPool().query("UPDATE engagement_scores SET band='thriving', e_score=0.9 WHERE user_id=$1", [user]);
    const res = await new NudgeScanner(testPool(), new NotificationService(testPool())).scanOnce();
    expect(res.nudged).toBe(0);
  });
});
