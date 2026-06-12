// Announcements (Contract Matrix B5): compose/schedule, audiences (all/cells/
// level), channels (push/email via notifications infra; sms/whatsapp via the
// MessageProvider stub; banner in-app), idempotent fan-out, delivered/open stats.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment } from "./helpers/factories.js";
import { AnnouncementService } from "../src/modules/announcements/service.js";
import { FakeMessageProvider } from "../src/modules/announcements/providers.js";

let cong: string, cellA: string, cellB: string;
let adminId: string, adminTok: string;
let memberA: string, memberATok: string; // in cellA, level 1
let memberB: string; // in cellB, level 2

const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" });
  adminId = admin.user_id;
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "ma@dev.local" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "mb@dev.local" });
  memberA = a.user_id;
  memberB = b.user_id;
  memberATok = bearer({ sub: memberA, role: "Student", cong });
  await createEnrollment(memberA, 1);
  await createEnrollment(memberB, 2);
});
afterAll(async () => {
  await closeTestPool();
});

function compose(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Easter service moved",
    body: "**Note:** service starts at 9am.",
    channels: ["banner"],
    audience: { kind: "all" },
    ...over,
  };
}

describe("compose + lifecycle", () => {
  it("creates a draft, edits it, then cancels — and blocks edits after sending", async () => {
    const created = await agent().post("/v1/admin/announcements").set(auth(adminTok)).send(compose());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");

    const id = created.body.announcement_id;
    const edited = await agent()
      .put(`/v1/admin/announcements/${id}`)
      .set(auth(adminTok))
      .send(compose({ title: "Easter service moved to 9am" }));
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("Easter service moved to 9am");

    const sent = await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminTok));
    expect(sent.status).toBe(200);

    const editAfter = await agent().put(`/v1/admin/announcements/${id}`).set(auth(adminTok)).send(compose());
    expect(editAfter.status).toBe(409);
    const cancelAfter = await agent().post(`/v1/admin/announcements/${id}/cancel`).set(auth(adminTok));
    expect(cancelAfter.status).toBe(409);
    const resend = await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminTok));
    expect(resend.status).toBe(409);
  });

  it("members cannot reach admin announcement routes", async () => {
    const res = await agent().post("/v1/admin/announcements").set(auth(memberATok)).send(compose());
    expect(res.status).toBe(403);
  });
});

describe("audiences + channels fan-out", () => {
  it("audience 'cells' reaches only that cell; banner shows up for the member with open receipt", async () => {
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminTok))
      .send(compose({ audience: { kind: "cells", cell_group_ids: [cellA] } }));
    const id = created.body.announcement_id;
    const sent = await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminTok));
    expect(sent.status).toBe(200);
    expect(sent.body.recipients).toBe(1); // only memberA is in cellA

    const mine = await agent().get("/v1/me/announcements").set(auth(memberATok));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].opened).toBe(false);

    const open = await agent().post(`/v1/announcements/${id}/open`).set(auth(memberATok));
    expect(open.status).toBe(200);
    expect(open.body.opened).toBe(true);
    const openAgain = await agent().post(`/v1/announcements/${id}/open`).set(auth(memberATok));
    expect(openAgain.body.opened).toBe(false); // idempotent — already stamped

    // memberB (cellB) never got it.
    const theirs = await testPool().query(
      `SELECT 1 FROM announcement_deliveries WHERE announcement_id=$1 AND user_id=$2`,
      [id, memberB],
    );
    expect(theirs.rowCount).toBe(0);
  });

  it("audience 'level' targets enrollments at that level", async () => {
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminTok))
      .send(compose({ audience: { kind: "level", level_number: 2 } }));
    const sent = await agent()
      .post(`/v1/admin/announcements/${created.body.announcement_id}/send`)
      .set(auth(adminTok));
    expect(sent.body.recipients).toBe(1); // only memberB is at level 2
    const who = await testPool().query(
      `SELECT user_id FROM announcement_deliveries WHERE announcement_id=$1`,
      [created.body.announcement_id],
    );
    expect(who.rows.map((r) => r.user_id)).toEqual([memberB]);
  });

  it("push rides notifications (suppressed when the member opted out); sms goes through the provider stub", async () => {
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, push_enabled) VALUES ($1, FALSE)`,
      [memberA],
    );
    const sms = new FakeMessageProvider("sms");
    const svc = new AnnouncementService(testPool(), { sms });

    const ann = await svc.create(adminId, {
      title: "Midweek prayer tonight",
      body: "Join at 6pm.",
      channels: ["push", "sms"],
      audience: { kind: "cells", cell_group_ids: [cellA] },
    });
    const result = await svc.send(adminId, ann.announcement_id);
    expect(result.recipients).toBe(1);
    expect(result.deliveries).toBe(2); // push + sms

    const rows = await testPool().query(
      `SELECT channel, status, notification_id, provider_ref FROM announcement_deliveries
        WHERE announcement_id=$1 ORDER BY channel`,
      [ann.announcement_id],
    );
    const push = rows.rows.find((r) => r.channel === "push");
    expect(push.status).toBe("suppressed"); // member turned push off
    expect(push.notification_id).not.toBeNull();
    const smsRow = rows.rows.find((r) => r.channel === "sms");
    expect(smsRow.status).toBe("delivered");
    expect(smsRow.provider_ref).toMatch(/^sms-fake-/);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.to).toBe("+254700000000");

    // Stats reflect the split.
    const detail = await agent()
      .get(`/v1/admin/announcements/${ann.announcement_id}`)
      .set(auth(adminTok));
    const byChannel = Object.fromEntries(detail.body.stats.map((s: { channel: string }) => [s.channel, s]));
    expect(byChannel.push.suppressed).toBe(1);
    expect(byChannel.sms.delivered).toBe(1);
  });

  it("re-sending after a partial fan-out is a no-op for already-covered recipients", async () => {
    const svc = new AnnouncementService(testPool());
    const ann = await svc.create(adminId, {
      title: "Harvest Sunday",
      body: "Bring a friend.",
      channels: ["banner"],
      audience: { kind: "all" },
    });
    // Simulate a crashed earlier send that covered memberA only.
    await testPool().query(
      `INSERT INTO announcement_deliveries (announcement_id, user_id, channel, status, delivered_at)
       VALUES ($1, $2, 'banner', 'delivered', now())`,
      [ann.announcement_id, memberA],
    );
    const result = await svc.send(adminId, ann.announcement_id);
    expect(result.deliveries).toBe(result.recipients - 1); // memberA skipped
    const total = await testPool().query(
      `SELECT count(*)::int AS n FROM announcement_deliveries WHERE announcement_id=$1`,
      [ann.announcement_id],
    );
    expect(total.rows[0].n).toBe(result.recipients); // exactly one row per recipient
  });
});

describe("scheduling", () => {
  it("scheduled announcements dispatch only once their time arrives", async () => {
    const svc = new AnnouncementService(testPool());
    const inOneHour = new Date(Date.now() + 3600_000).toISOString();
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminTok))
      .send(compose({ scheduled_at: inOneHour }));
    expect(created.body.status).toBe("scheduled");

    expect(await svc.dispatchDue(new Date())).toBe(0); // not due yet
    expect(await svc.dispatchDue(new Date(Date.now() + 2 * 3600_000))).toBe(1);

    const after = await agent()
      .get(`/v1/admin/announcements/${created.body.announcement_id}`)
      .set(auth(adminTok));
    expect(after.body.status).toBe("sent");
    expect(await svc.dispatchDue(new Date(Date.now() + 2 * 3600_000))).toBe(0); // not re-sent
  });

  it("a cancelled scheduled announcement never dispatches", async () => {
    const svc = new AnnouncementService(testPool());
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminTok))
      .send(compose({ scheduled_at: new Date(Date.now() + 60_000).toISOString() }));
    const cancel = await agent()
      .post(`/v1/admin/announcements/${created.body.announcement_id}/cancel`)
      .set(auth(adminTok));
    expect(cancel.status).toBe(200);
    expect(await svc.dispatchDue(new Date(Date.now() + 120_000))).toBe(0);
  });
});
