// Notifications — quiet-hours scheduling + daily cap + channel prefs (§1.5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { NotificationService, nextSendTime } from "../src/modules/notifications/service.js";

// 2026-06-06T22:30:00Z — inside a 21:00→07:00 UTC quiet window.
const QUIET_UTC = Date.parse("2026-06-06T22:30:00Z");
// 2026-06-06T12:00:00Z — outside it.
const AWAKE_UTC = Date.parse("2026-06-06T12:00:00Z");

describe("nextSendTime (quiet hours)", () => {
  it("sends immediately when outside the quiet window", () => {
    expect(nextSendTime(AWAKE_UTC, "UTC", "21:00", "07:00").getTime()).toBe(AWAKE_UTC);
  });
  it("defers to the window end when inside (wrap-around)", () => {
    const out = nextSendTime(QUIET_UTC, "UTC", "21:00", "07:00");
    // 22:30 → next 07:00 is 8h30m later.
    expect(out.getTime()).toBe(QUIET_UTC + (8 * 60 + 30) * 60_000);
  });
});

describe("NotificationService (§1.5)", () => {
  let user: string;
  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("schedules a push at an awake time", async () => {
    const svc = new NotificationService(testPool(), () => AWAKE_UTC);
    const n = await svc.schedule({ userId: user, channel: "push", template: "level_completed", timezone: "UTC" });
    expect(n.status).toBe("scheduled");
  });

  it("suppresses when the channel is disabled", async () => {
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, push_enabled) VALUES ($1, FALSE)`,
      [user],
    );
    const svc = new NotificationService(testPool(), () => AWAKE_UTC);
    const n = await svc.schedule({ userId: user, channel: "push", template: "nudge", timezone: "UTC" });
    expect(n.status).toBe("suppressed");
  });

  it("suppresses once the daily cap is reached", async () => {
    await testPool().query(`INSERT INTO notification_preferences (user_id, max_daily) VALUES ($1, 1)`, [user]);
    const svc = new NotificationService(testPool(), () => AWAKE_UTC);
    const first = await svc.schedule({ userId: user, channel: "push", template: "n1", timezone: "UTC" });
    const second = await svc.schedule({ userId: user, channel: "push", template: "n2", timezone: "UTC" });
    expect(first.status).toBe("scheduled");
    expect(second.status).toBe("suppressed");
  });
});
