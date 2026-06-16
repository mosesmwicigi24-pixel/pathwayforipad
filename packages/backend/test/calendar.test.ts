// Calendar subsystem (Features v2 §C): TZ-aware recurrence, projection,
// materialization, RSVP, visibility scoping, RRULE allow-list.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createLeaderAssignment } from "./helpers/factories.js";
import { validateRrule, expandOccurrences } from "../src/modules/calendar/recurrence.js";
import { CalendarService } from "../src/modules/calendar/service.js";
import type { Principal } from "../src/http/http.js";

const svc = () => new CalendarService(testPool());
const principal = (userId: string, role: Principal["role"], cong: string): Principal => ({ userId, role, congregationId: cong });

describe("RRULE recurrence engine (§C.0/§D.2/§C.4)", () => {
  it("rejects disallowed or unbounded rules and accepts a valid one", () => {
    expect(() => validateRrule("FREQ=YEARLY;COUNT=5")).toThrow();
    expect(() => validateRrule("FREQ=WEEKLY;INTERVAL=8;COUNT=5")).toThrow();
    expect(() => validateRrule("FREQ=DAILY")).toThrow(); // unbounded
    expect(() => validateRrule("FREQ=WEEKLY;BYDAY=SU;COUNT=4")).not.toThrow();
  });

  it("expands in the series timezone, holding wall-clock across a DST boundary", () => {
    const occ = expandOccurrences(
      { timezone: "America/New_York", dtstart_local: "2025-03-01T09:00:00", duration_min: 60, rrule: "FREQ=WEEKLY;COUNT=4" },
      new Date("2025-02-01T00:00:00Z"),
      new Date("2025-05-01T00:00:00Z"),
      500,
    );
    expect(occ).toHaveLength(4);
    // Mar 1 & 8 are EST (UTC-5) → 09:00 local = 14:00Z; Mar 15+ are EDT (UTC-4) → 13:00Z.
    expect(occ[0]!.start_at).toContain("T14:00");
    expect(occ[2]!.start_at).toContain("T13:00");
  });
});

describe("series → projection → materialization → RSVP (§C.2/§C.3)", () => {
  let cong: string, admin: string, member: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    member = (await createUser({ congregationId: cong, role: "Student", email: "m@dev.local" })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a weekly series, projects it, materializes events, and records an RSVP", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Sunday Service",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T09:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=4",
      visibility: "congregation",
    })) as { series_id: string };

    const projected = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    expect(projected.length).toBe(4);

    const mat = await svc().materialize(s.series_id);
    expect(mat.created).toBeGreaterThan(0);
    const ev = await testPool().query("SELECT event_id, qr_secret FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1", [s.series_id]);
    expect(ev.rows[0].qr_secret).toBeTruthy();
    const eventId = ev.rows[0].event_id;

    const r1 = await svc().setRsvp(member, eventId, { status: "going", client_mutation_id: "00000000-0000-4000-8000-0000000000aa" });
    expect(r1).toMatchObject({ duplicate: false, status: "going" });
    const dup = await svc().setRsvp(member, eventId, { status: "going", client_mutation_id: "00000000-0000-4000-8000-0000000000aa" });
    expect(dup.duplicate).toBe(true);

    const detail = (await svc().getEvent(member, eventId)) as { rsvp_counts: Record<string, number>; my_rsvp: string };
    expect(detail.rsvp_counts.going).toBe(1);
    expect(detail.my_rsvp).toBe("going");
  });

  it("applies a cancellation exception (occurrence disappears from projection)", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Cell Meeting",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T18:00:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=3",
      visibility: "congregation",
    })) as { series_id: string };

    const before = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    const firstStart = (before[0] as { start_at: string }).start_at;
    await svc().addException(principal(admin, "Admin", cong), s.series_id, { original_start_at: firstStart, is_cancelled: true });
    const after = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    expect(after.length).toBe(before.length - 1);
  });
});

describe("visibility scoping + RBAC (§5.4)", () => {
  let cong: string, admin: string, leader: string, cellA: string, cellB: string, memberA: string, memberB: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cellA = await createCellGroup(cong, "Cell A");
    cellB = await createCellGroup(cong, "Cell B");
    admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    leader = (await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" })).user_id;
    await createLeaderAssignment(leader, cellA);
    memberA = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellA, email: "ma@dev.local" })).user_id;
    memberB = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellB, email: "mb@dev.local" })).user_id;
  });

  it("a cell-scoped series is visible to that cell but not another", async () => {
    await svc().createSeries(principal(leader, "Instructor", cong), {
      title: "Cell A only",
      cell_group_id: cellA,
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T18:00:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=2",
      visibility: "cell",
    });
    const seenByA = await svc().projectRange(memberA, "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z");
    const seenByB = await svc().projectRange(memberB, "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByB.length).toBe(0);
  });

  it("a Student cannot create a series (403 FORBIDDEN_SCOPE)", async () => {
    await expect(
      svc().createSeries(principal(memberA, "Student", cong), {
        title: "nope",
        timezone: "Africa/Nairobi",
        dtstart_local: "2026-06-07T18:00:00",
        duration_min: 60,
        visibility: "cell",
        cell_group_id: cellA,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
});

describe("RSVP roster (Events page)", () => {
  let cong: string, admin: string, leader: string, cellA: string, cellB: string;
  let goer: string, mayber: string, decliner: string, noResp: string, outsider: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cellA = await createCellGroup(cong, "Cell A");
    cellB = await createCellGroup(cong, "Cell B");
    admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    leader = (await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" })).user_id;
    await createLeaderAssignment(leader, cellA);
    goer = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellA, fullName: "Aaron Goer", email: "g@dev.local" })).user_id;
    mayber = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellA, fullName: "Bea Mayber", email: "may@dev.local" })).user_id;
    decliner = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellA, fullName: "Cara Decliner", email: "d@dev.local" })).user_id;
    noResp = (await createUser({ congregationId: cong, role: "Student", cellGroupId: cellA, fullName: "Dan NoResponse", email: "n@dev.local" })).user_id;
    outsider = (await createUser({ congregationId: cong, role: "Instructor", email: "out@dev.local" })).user_id;
    await createLeaderAssignment(outsider, cellB);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedOccurrence(): Promise<{ seriesId: string; eventId: string }> {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Cell A Gathering",
      cell_group_id: cellA,
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T18:00:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=6",
      visibility: "cell",
    })) as { series_id: string };
    await svc().materialize(s.series_id);
    const ev = await testPool().query(
      "SELECT event_id FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1",
      [s.series_id],
    );
    return { seriesId: s.series_id, eventId: ev.rows[0].event_id };
  }

  it("returns mixed RSVPs grouped into buckets with correct counts + no_response", async () => {
    const { eventId } = await seedOccurrence();
    await svc().setRsvp(goer, eventId, { status: "going" });
    await svc().setRsvp(mayber, eventId, { status: "maybe" });
    await svc().setRsvp(decliner, eventId, { status: "declined" });

    const roster = (await svc().rsvpRoster(principal(leader, "Instructor", cong), eventId)) as {
      buckets: Record<string, { user_id: string; full_name: string; response: string; cell_name: string | null }[]>;
      counts: Record<string, number>;
      no_response_scope: string;
    };

    expect(roster.counts).toMatchObject({ going: 1, maybe: 1, declined: 1, no_response: 1 });
    expect(roster.buckets.going![0]).toMatchObject({ user_id: goer, response: "going", cell_name: "Cell A" });
    expect(roster.buckets.no_response!.map((r) => r.user_id)).toContain(noResp);
    expect(roster.buckets.no_response!.map((r) => r.user_id)).not.toContain(goer);
    expect(roster.no_response_scope).toBe("cell");
  });

  it("an out-of-scope leader gets 403 FORBIDDEN_SCOPE", async () => {
    const { eventId } = await seedOccurrence();
    await expect(svc().rsvpRoster(principal(outsider, "Instructor", cong), eventId)).rejects.toMatchObject({
      code: "FORBIDDEN_SCOPE",
    });
  });

  it("404s for an unknown occurrence", async () => {
    await expect(svc().rsvpRoster(principal(admin, "Admin", cong), "does-not-exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("series pause / resume (Events page)", () => {
  let cong: string, admin: string, member: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    member = (await createUser({ congregationId: cong, role: "Student", email: "m@dev.local" })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("pause hides a series' future occurrences from projectRange; resume restores them", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Weekly",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T09:00:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=4",
      visibility: "congregation",
    })) as { series_id: string };

    const before = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    expect(before.length).toBe(4);

    const paused = (await svc().pauseSeries(principal(admin, "Admin", cong), s.series_id)) as { is_paused: boolean };
    expect(paused.is_paused).toBe(true);
    const whilePaused = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    expect(whilePaused.length).toBe(0);

    const resumed = (await svc().resumeSeries(principal(admin, "Admin", cong), s.series_id)) as { is_paused: boolean };
    expect(resumed.is_paused).toBe(false);
    const after = await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z");
    expect(after.length).toBe(4);
  });

  it("404s when pausing an unknown series", async () => {
    await expect(
      svc().pauseSeries(principal(admin, "Admin", cong), "00000000-0000-4000-8000-0000000000ff"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
