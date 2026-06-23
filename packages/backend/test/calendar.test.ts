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

describe("Events tab: category, going counts, series follow, cell summary", () => {
  let cong: string, admin: string, member: string, cell: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong, "Karen East");
    admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    member = (await createUser({ congregationId: cong, cellGroupId: cell, role: "Student", email: "m@dev.local" })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("projects a series category and real per-occurrence going counts", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Sunday Worship Service",
      category: "worship",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T09:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=4",
      visibility: "congregation",
    })) as { series_id: string };
    await svc().materialize(s.series_id);
    const ev = await testPool().query("SELECT event_id FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1", [s.series_id]);
    await svc().setRsvp(member, ev.rows[0].event_id, { status: "going" });

    const projected = (await svc().projectRange(member, "2026-06-01T00:00:00Z", "2026-07-15T00:00:00Z")) as Array<{ category: string; going: number }>;
    expect(projected[0]!.category).toBe("worship");
    // materialize only creates future occurrences, so the RSVP lands on whichever
    // occurrence got materialized — assert exactly one "going" across the series.
    expect(projected.reduce((sum, o) => sum + o.going, 0)).toBe(1);
  });

  it("RSVPs to a projected occurrence id (materialized on demand) and reflects the count", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Friday Encounter",
      category: "worship",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-07-03T18:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;BYDAY=FR;COUNT=6",
      visibility: "congregation",
    })) as { series_id: string };
    // No materialize() — the member opens a projected occurrence straight from the list.
    const projected = (await svc().projectRange(member, "2026-06-25T00:00:00Z", "2026-08-15T00:00:00Z")) as Array<{ occurrence_id: string }>;
    const occId = projected[0]!.occurrence_id;
    expect(occId).toContain(":"); // synthetic series_id:ISO, not yet a materialized row
    const before = await testPool().query("SELECT count(*)::int AS n FROM events WHERE series_id=$1", [s.series_id]);
    expect(before.rows[0].n).toBe(0);

    const res = await svc().setRsvp(member, occId, { status: "going" });
    expect(res.status).toBe("going");
    const after = await testPool().query("SELECT count(*)::int AS n FROM events WHERE event_id=$1", [occId]);
    expect(after.rows[0].n).toBe(1); // materialized on demand

    const detail = (await svc().getEvent(member, occId)) as { rsvp_counts: Record<string, number>; my_rsvp: string };
    expect(detail.rsvp_counts.going).toBe(1);
    expect(detail.my_rsvp).toBe("going");

    // changing the answer updates in place (no double count)
    await svc().setRsvp(member, occId, { status: "maybe" });
    const detail2 = (await svc().getEvent(member, occId)) as { rsvp_counts: Record<string, number>; my_rsvp: string };
    expect(detail2.my_rsvp).toBe("maybe");
    expect(detail2.rsvp_counts.going ?? 0).toBe(0);
  });

  it("listSeries exposes the next occurrence as a tappable event id", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Sunday Service",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-07-05T09:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=6",
      visibility: "congregation",
    })) as { series_id: string };
    const projected = (await svc().projectRange(member, "2026-06-25T00:00:00Z", "2026-08-15T00:00:00Z")) as Array<{ occurrence_id: string; series_id: string }>;
    const next = projected.find((o) => o.series_id === s.series_id)!;
    const list = (await svc().listSeries(member)) as Array<{ series_id: string; next_occurrence_id: string | null; next_at: string | null }>;
    const row = list.find((x) => x.series_id === s.series_id)!;
    expect(row.next_occurrence_id).toBe(next.occurrence_id);
    expect(row.next_at).toBeTruthy();
  });

  it("follows then unfollows a series (idempotent toggle)", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Midweek Cell",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-10T18:30:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=6",
      visibility: "congregation",
    })) as { series_id: string };

    let list = (await svc().listSeries(member)) as Array<{ series_id: string; following: boolean; cadence: string }>;
    const before = list.find((x) => x.series_id === s.series_id)!;
    expect(before.following).toBe(false);
    expect(before.cadence).toContain("Wednesday");

    const on = await svc().toggleFollow(member, s.series_id);
    expect(on.following).toBe(true);
    list = (await svc().listSeries(member)) as Array<{ series_id: string; following: boolean }>;
    expect(list.find((x) => x.series_id === s.series_id)!.following).toBe(true);

    const off = await svc().toggleFollow(member, s.series_id);
    expect(off.following).toBe(false);
  });

  it("summarizes the member's cell (name, members, attendance, next)", async () => {
    const summary = (await svc().cellSummary(member)) as { cell: { name: string; members: number; attendance: { expected: number } } | null };
    expect(summary.cell).not.toBeNull();
    expect(summary.cell!.name).toBe("Karen East");
    expect(summary.cell!.members).toBeGreaterThanOrEqual(1);
    expect(summary.cell!.attendance.expected).toBeGreaterThan(0);
  });
});

describe("admin portal Create-event contract (POST /admin/events/series)", () => {
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

  it("normalizes the portal payload (start_date/start_time, members visibility) to the series model", () => {
    const parsed = CalendarService.CreateSeries.parse({
      title: "Sunday Worship Service",
      category: "worship",
      timezone: "Africa/Nairobi",
      starts_at: "2026-07-19T15:00:00.000Z",
      start_date: "2026-07-19",
      start_time: "18:00",
      duration_min: 180,
      visibility: "members",
      rsvp_enabled: true,
      qr_enabled: true,
      manual_checkin_enabled: true,
      status: "active",
    });
    expect(parsed).toMatchObject({
      title: "Sunday Worship Service",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-07-19T18:00:00", // wall-clock from start_date + start_time
      duration_min: 180,
      visibility: "congregation", // "members" → congregation
      status: "active",
    });
    // category is now persisted (Events make filter + badge); other presentational-only
    // fields are still dropped, not rejected (no .strict() failure).
    expect((parsed as Record<string, unknown>).category).toBe("worship");
    expect((parsed as Record<string, unknown>).manual_checkin_enabled).toBeUndefined();
  });

  it("bounds the portal's open-ended RRULE so it passes validation and creates", async () => {
    // The modal emits FREQ=WEEKLY;BYDAY=SU with no COUNT/UNTIL — previously a 422.
    const parsed = CalendarService.CreateSeries.parse({
      title: "Weekly Service",
      timezone: "Africa/Nairobi",
      start_date: "2026-07-05",
      start_time: "09:00",
      duration_min: 90,
      visibility: "members",
      rrule: "FREQ=WEEKLY;BYDAY=SU",
    });
    expect(parsed.rrule).toMatch(/UNTIL=\d{8}T\d{6}Z$/);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), parsed)) as { series_id: string };
    const projected = await svc().projectRange(member, "2026-07-01T00:00:00Z", "2026-08-15T00:00:00Z");
    expect(projected.length).toBeGreaterThan(0);
    expect((projected[0] as { series_id: string }).series_id).toBe(s.series_id);
  });

  it("Save as draft: hidden from members, visible to the admin, and not materialized", async () => {
    const parsed = CalendarService.CreateSeries.parse({
      title: "Draft Service",
      timezone: "Africa/Nairobi",
      start_date: "2026-07-05",
      start_time: "09:00",
      duration_min: 90,
      visibility: "members",
      rrule: "FREQ=WEEKLY;BYDAY=SU",
      status: "draft",
    });
    expect(parsed.status).toBe("draft");
    const s = (await svc().createSeries(principal(admin, "Admin", cong), parsed)) as { series_id: string };

    const seenByMember = await svc().projectRange(member, "2026-07-01T00:00:00Z", "2026-08-15T00:00:00Z");
    expect(seenByMember.length).toBe(0); // drafts never reach members

    const seenByAdmin = await svc().projectRange(admin, "2026-07-01T00:00:00Z", "2026-08-15T00:00:00Z");
    expect(seenByAdmin.length).toBeGreaterThan(0); // creator still sees the draft
    expect((seenByAdmin[0] as { status: string }).status).toBe("draft");

    // A draft is not materialized (no occurrence rows / reminders) until published.
    const ev = await testPool().query("SELECT COUNT(*)::int AS n FROM events WHERE series_id = $1", [s.series_id]);
    expect(ev.rows[0].n).toBe(0);
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

describe("event images + homepage feature (migration 52)", () => {
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

  it("stores a cover + gallery, surfaces them on the member detail carousel, and features one on the homepage", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Easter Convention",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T09:00:00",
      duration_min: 90,
      rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=8",
      visibility: "congregation",
      primary_image_url: "https://res.cloudinary.com/x/cover.jpg",
      gallery_image_urls: ["https://res.cloudinary.com/x/g1.jpg", "https://res.cloudinary.com/x/g2.jpg"],
    })) as { series_id: string };

    await svc().materialize(s.series_id);
    const ev = await testPool().query("SELECT event_id FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1", [s.series_id]);
    const detail = (await svc().getEvent(member, ev.rows[0].event_id)) as { images: string[]; primary_image_url: string };
    expect(detail.primary_image_url).toContain("cover.jpg");
    expect(detail.images).toHaveLength(3); // primary + 2 gallery
    expect(detail.images[0]).toContain("cover.jpg");

    // No featured event yet.
    expect(await svc().featuredEvent(cong)).toBeNull();
    // Feature it on the homepage.
    const feat = await svc().setSeriesFeatured(principal(admin, "Admin", cong), s.series_id, true);
    expect(feat.is_featured).toBe(true);
    const home = (await svc().featuredEvent(cong)) as { series_id: string; primary_image_url: string };
    expect(home.series_id).toBe(s.series_id);
    expect(home.primary_image_url).toContain("cover.jpg");
    // Unfeature.
    await svc().setSeriesFeatured(principal(admin, "Admin", cong), s.series_id, false);
    expect(await svc().featuredEvent(cong)).toBeNull();
  });

  it("updateSeries can change the cover image and gallery", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Prayer Night",
      timezone: "Africa/Nairobi",
      dtstart_local: "2026-06-07T18:00:00",
      duration_min: 60,
      rrule: "FREQ=WEEKLY;BYDAY=FR;COUNT=2",
      visibility: "congregation",
    })) as { series_id: string };
    await svc().updateSeries(principal(admin, "Admin", cong), s.series_id, {
      primary_image_url: "https://res.cloudinary.com/x/new.jpg",
      gallery_image_urls: ["https://res.cloudinary.com/x/extra.jpg"],
    });
    const row = await testPool().query("SELECT primary_image_url, gallery_image_urls FROM event_series WHERE series_id=$1", [s.series_id]);
    expect(row.rows[0].primary_image_url).toContain("new.jpg");
    expect(row.rows[0].gallery_image_urls).toHaveLength(1);
  });
});
