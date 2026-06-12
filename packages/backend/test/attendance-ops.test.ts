// Attendance + events ops (Contract Matrix B2): manual check-in (scoped, reason,
// idempotent), guests, roster (RSVP'd-but-absent), event toggles enforced, My
// RSVPs, RSVP reminders, cancel/reschedule notifications.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEvent, createLeaderAssignment } from "./helpers/factories.js";
import { CalendarService } from "../src/modules/calendar/service.js";
import type { Principal } from "../src/http/http.js";

let cong: string, cellA: string, cellB: string;
let adminId: string, leaderId: string, memberId: string;
let adminTok: string, leaderTok: string, memberTok: string;

const auth = (t: string) => ({ Authorization: t });
const principal = (userId: string, role: Principal["role"]): Principal => ({ userId, role, congregationId: cong });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" });
  const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" });
  const member = await createUser({ congregationId: cong, cellGroupId: cellA, role: "Student", email: "m@dev.local" });
  adminId = admin.user_id;
  leaderId = leader.user_id;
  memberId = member.user_id;
  await createLeaderAssignment(leaderId, cellA);
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
  leaderTok = bearer({ sub: leaderId, role: "Instructor", cong });
  memberTok = bearer({ sub: memberId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("manual check-in (scoped, idempotent, audited)", () => {
  it("a leader of the event's cell records a manual check-in with a reason; replay is duplicate", async () => {
    const { event_id } = await createEvent(cong, { cellGroupId: cellA });
    const first = await agent()
      .post(`/v1/admin/events/${event_id}/checkins`)
      .set(auth(leaderTok))
      .send({ user_id: memberId, note: "Phone died — verified at the door" });
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);

    const again = await agent()
      .post(`/v1/admin/events/${event_id}/checkins`)
      .set(auth(leaderTok))
      .send({ user_id: memberId });
    expect(again.body.duplicate).toBe(true);

    const log = await testPool().query(
      "SELECT method, recorded_by, note FROM attendance_logs WHERE user_id=$1 AND event_id=$2",
      [memberId, event_id],
    );
    expect(log.rows[0]).toMatchObject({ method: "manual", recorded_by: leaderId });
    const aud = await testPool().query("SELECT count(*)::int n FROM audit_log WHERE action='attendance.manual_checkin'");
    expect(aud.rows[0].n).toBe(1);
  });

  it("an instructor outside the event's cell gets 403; disallowed events 422", async () => {
    const other = await createEvent(cong, { eventId: "other-cell-evt", cellGroupId: cellB });
    const denied = await agent()
      .post(`/v1/admin/events/${other.event_id}/checkins`)
      .set(auth(leaderTok))
      .send({ user_id: memberId });
    expect(denied.status).toBe(403);

    const { event_id } = await createEvent(cong, { eventId: "no-manual-evt", cellGroupId: cellA });
    await testPool().query("UPDATE events SET allow_manual_checkin = FALSE WHERE event_id=$1", [event_id]);
    const blocked = await agent()
      .post(`/v1/admin/events/${event_id}/checkins`)
      .set(auth(leaderTok))
      .send({ user_id: memberId });
    expect(blocked.status).toBe(422);
  });
});

describe("guests + roster", () => {
  it("records a walk-in and the roster shows checked-in, guests, and RSVP'd-but-absent", async () => {
    const { event_id } = await createEvent(cong, { cellGroupId: cellA });
    // RSVP'd member who never checks in:
    const ghost = await createUser({ congregationId: cong, cellGroupId: cellA, email: "g@dev.local" });
    await testPool().query(
      `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`,
      [event_id, ghost.user_id],
    );
    await agent().post(`/v1/admin/events/${event_id}/checkins`).set(auth(leaderTok)).send({ user_id: memberId });
    const guest = await agent()
      .post(`/v1/admin/events/${event_id}/guests`)
      .set(auth(leaderTok))
      .send({ guest_name: "First-time Visitor", first_time: true });
    expect(guest.status).toBe(201);

    const roster = await agent().get(`/v1/admin/events/${event_id}/attendance`).set(auth(leaderTok));
    expect(roster.status).toBe(200);
    expect(roster.body.checked_in).toHaveLength(1);
    expect(roster.body.checked_in[0].method).toBe("manual");
    expect(roster.body.guests[0].guest_name).toBe("First-time Visitor");
    expect(roster.body.rsvp_no_show.map((m: { user_id: string }) => m.user_id)).toEqual([ghost.user_id]);

    const memberDenied = await agent().get(`/v1/admin/events/${event_id}/attendance`).set(auth(memberTok));
    expect(memberDenied.status).toBe(403);
  });
});

describe("event toggles enforced server-side", () => {
  it("QR check-in rejects when qr_enabled=false or before the check-in window", async () => {
    const { event_id, qr_secret } = await createEvent(cong, { cellGroupId: cellA });
    void qr_secret;
    await testPool().query("UPDATE events SET qr_enabled = FALSE WHERE event_id=$1", [event_id]);
    const res = await agent()
      .post(`/v1/events/${event_id}/attendance`)
      .set(auth(memberTok))
      .send({ client_scan_id: "00000000-0000-4000-8000-0000000000aa", scan_token: "x" });
    expect(res.status).toBe(422);

    await testPool().query(
      "UPDATE events SET qr_enabled = TRUE, checkin_opens_at = now() + interval '2 hours' WHERE event_id=$1",
      [event_id],
    );
    const early = await agent()
      .post(`/v1/events/${event_id}/attendance`)
      .set(auth(memberTok))
      .send({ client_scan_id: "00000000-0000-4000-8000-0000000000ab", scan_token: "x" });
    expect(early.status).toBe(422);
  });

  it("RSVP rejects when rsvp_enabled=false", async () => {
    const { event_id } = await createEvent(cong, { cellGroupId: cellA });
    await testPool().query("UPDATE events SET rsvp_enabled = FALSE WHERE event_id=$1", [event_id]);
    const res = await agent().post(`/v1/events/${event_id}/rsvp`).set(auth(memberTok)).send({ status: "going" });
    expect(res.status).toBe(422);
  });
});

describe("RSVP reminders + My RSVPs", () => {
  it("a future 'going' RSVP schedules T-24h and T-1h reminders and shows in /me/rsvps", async () => {
    const { event_id } = await createEvent(cong, { cellGroupId: cellA });
    await testPool().query("UPDATE events SET occurs_at = now() + interval '3 days' WHERE event_id=$1", [event_id]);

    const res = await agent().post(`/v1/events/${event_id}/rsvp`).set(auth(memberTok)).send({ status: "going" });
    expect(res.status).toBe(200);

    const reminders = await testPool().query(
      `SELECT template FROM notifications WHERE user_id=$1 AND template LIKE 'event_reminder%' ORDER BY scheduled_for`,
      [memberId],
    );
    expect(reminders.rows.map((r) => r.template)).toEqual(["event_reminder_24h", "event_reminder_1h"]);

    const mine = await agent().get("/v1/me/rsvps").set(auth(memberTok));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ event_id, status: "going" });
  });
});

describe("cancel/reschedule notifications + materialized toggles", () => {
  it("cancelling an occurrence notifies going-RSVPs; materializer copies series toggles", async () => {
    const svc = new CalendarService(testPool());
    const series = (await svc.createSeries(principal(adminId, "Admin"), {
      title: "Midweek Service",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-07-01T18:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;COUNT=3",
      visibility: "congregation",
      rsvp_enabled: true,
      qr_enabled: false, // toggle should flow onto occurrences
      reminders_enabled: true,
      checkin_opens_min_before: 30,
    })) as { series_id: string };
    await svc.materialize(series.series_id);

    const ev = await testPool().query(
      "SELECT event_id, occurrence_start, qr_enabled, checkin_opens_at FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1",
      [series.series_id],
    );
    expect(ev.rows[0].qr_enabled).toBe(false);
    expect(ev.rows[0].checkin_opens_at).not.toBeNull();

    const eventId = ev.rows[0].event_id;
    await testPool().query(`INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`, [eventId, memberId]);

    await svc.addException(principal(adminId, "Admin"), series.series_id, {
      original_start_at: new Date(ev.rows[0].occurrence_start).toISOString(),
      is_cancelled: true,
      note: "Venue unavailable",
    });
    const note = await testPool().query(
      `SELECT template FROM notifications WHERE user_id=$1 AND template='event_cancelled'`,
      [memberId],
    );
    expect(note.rowCount).toBe(1);
  });
});
