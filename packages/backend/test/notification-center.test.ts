// Notification center (Design spec D1): member list + unread badge + mark-read.
// Display state only — read_at never affects scheduling/dispatch.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let meTok: string, me: string, other: string;
const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, email: "other@dev.local" });
  me = a.user_id;
  other = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
  // Two sent for me (unread), one suppressed (hidden), one for someone else.
  await testPool().query(
    `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for, sent_at) VALUES
      ($1,'push','event_reminder_24h','{}','sent', now() - interval '2 hours', now() - interval '2 hours'),
      ($1,'push','announcement','{"title":"Hall B"}','sent', now() - interval '1 hour', now() - interval '1 hour'),
      ($1,'push','nudge','{}','suppressed', now(), NULL),
      ($2,'push','announcement','{}','sent', now(), now())`,
    [me, other],
  );
});
afterAll(async () => {
  await closeTestPool();
});

describe("notification center (D1)", () => {
  it("lists only my non-suppressed notifications, newest first, with unread count", async () => {
    const res = await agent().get("/v1/me/notifications").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].template).toBe("announcement"); // newest first
    expect(res.body.unread).toBe(2);
    expect(res.body.data.map((n: { template: string }) => n.template)).not.toContain("nudge");
  });

  it("marks all read idempotently; unread drops to zero", async () => {
    const first = await agent().post("/v1/me/notifications/read").set(auth(meTok)).send({});
    expect(first.body.marked).toBe(2);
    const again = await agent().post("/v1/me/notifications/read").set(auth(meTok)).send({});
    expect(again.body.marked).toBe(0); // idempotent
    const after = await agent().get("/v1/me/notifications").set(auth(meTok));
    expect(after.body.unread).toBe(0);
    expect(after.body.data[0].read_at).not.toBeNull();
  });

  it("marks a single id read without touching the rest or other users", async () => {
    const list = await agent().get("/v1/me/notifications").set(auth(meTok));
    const target = list.body.data[0].notification_id;
    const res = await agent().post("/v1/me/notifications/read").set(auth(meTok)).send({ ids: [target] });
    expect(res.body.marked).toBe(1);
    const after = await agent().get("/v1/me/notifications").set(auth(meTok));
    expect(after.body.unread).toBe(1);
    const theirs = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NOT NULL`,
      [other],
    );
    expect(theirs.rows[0].n).toBe(0);
  });
});
