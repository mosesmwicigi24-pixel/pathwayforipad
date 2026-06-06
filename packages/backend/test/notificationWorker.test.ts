// Notification dispatch worker — sends due notifications, marks sent/failed (§1.5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { NotificationWorker } from "../src/workers/notificationWorker.js";
import type { DispatchMessage, DispatchProvider } from "../src/workers/dispatch.js";

class FakeProvider implements DispatchProvider {
  public sends: DispatchMessage[] = [];
  send(msg: DispatchMessage): Promise<void> {
    this.sends.push(msg);
    return Promise.resolve();
  }
}

async function scheduleDue(userId: string, channel: "push" | "email"): Promise<void> {
  await testPool().query(
    `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
     VALUES ($1, $2, 'nudge', '{}'::jsonb, 'scheduled', now() - interval '1 minute')`,
    [userId, channel],
  );
}

describe("notification dispatch worker (§1.5)", () => {
  let cong: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("sends a due email notification and marks it sent", async () => {
    const user = (await createUser({ congregationId: cong, email: "ada@example.com" })).user_id;
    await scheduleDue(user, "email");
    const provider = new FakeProvider();

    const res = await new NotificationWorker(testPool(), provider).dispatchDue();
    expect(res.sent).toBe(1);
    expect(provider.sends[0]).toMatchObject({ channel: "email", to: "ada@example.com" });

    const row = await testPool().query("SELECT status FROM notifications WHERE user_id=$1", [user]);
    expect(row.rows[0].status).toBe("sent");
  });

  it("fails a notification with no deliverable destination", async () => {
    const user = (await createUser({ congregationId: cong, email: null })).user_id; // no email, no push token
    await scheduleDue(user, "push");
    const provider = new FakeProvider();

    const res = await new NotificationWorker(testPool(), provider).dispatchDue();
    expect(res.failed).toBe(1);
    expect(provider.sends).toHaveLength(0);
    const row = await testPool().query("SELECT status FROM notifications WHERE user_id=$1", [user]);
    expect(row.rows[0].status).toBe("failed");
  });

  it("leaves future notifications alone", async () => {
    const user = (await createUser({ congregationId: cong, email: "x@y.z" })).user_id;
    await testPool().query(
      `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
       VALUES ($1, 'email', 'later', '{}'::jsonb, 'scheduled', now() + interval '1 hour')`,
      [user],
    );
    const res = await new NotificationWorker(testPool(), new FakeProvider()).dispatchDue();
    expect(res.sent).toBe(0);
  });
});
