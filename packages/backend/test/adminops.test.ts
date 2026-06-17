// ERP core (Contract Matrix B1): dashboard reports, members admin, audit viewer,
// certificates register (issue/revoke → public verify flips invalid), finance reads.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createEvent } from "./helpers/factories.js";

let cong: string;
let cell: string;
let adminTok: string;
let superTok: string;
let studentTok: string;
let studentId: string;

const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong);
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" });
  const sup = await createUser({ congregationId: cong, role: "SuperAdmin", email: "s@dev.local" });
  const student = await createUser({ congregationId: cong, cellGroupId: cell, role: "Student", email: "m@dev.local" });
  studentId = student.user_id;
  await createEnrollment(studentId, 1);
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  superTok = bearer({ sub: sup.user_id, role: "SuperAdmin", cong });
  studentTok = bearer({ sub: student.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("dashboard reports", () => {
  it("overview returns the KPI block with real counts", async () => {
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.1, 0.1, 0.1, 0.12, 'at_risk', CURRENT_DATE)`,
      [studentId, cell],
    );
    const res = await agent().get("/v1/admin/reports/overview").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.total_members).toBe(1); // only the Student counts
    expect(res.body.members_at_risk).toBe(1);
    expect(res.body.cohorts_running).toBe(1);
    expect(typeof res.body.avg_engagement).toBe("number");
  });

  it("engagement report returns band distribution and per-cell rows", async () => {
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.8, 0.8, 0.8, 0.8, 'thriving', CURRENT_DATE)`,
      [studentId, cell],
    );
    const res = await agent().get("/v1/admin/reports/engagement").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.bands.thriving).toBe(1);
    expect(res.body.cells[0].members).toBe(1);
  });

  it("attendance report returns a weekly trend", async () => {
    const { event_id } = await createEvent(cong, { cellGroupId: cell });
    await testPool().query(
      `INSERT INTO attendance_logs (user_id, event_id, client_scan_id) VALUES ($1, $2, gen_random_uuid())`,
      [studentId, event_id],
    );
    const res = await agent().get("/v1/admin/reports/attendance").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.trend.length).toBeGreaterThan(0);
    expect(res.body.trend.at(-1).check_ins).toBe(1);
    expect(res.body.recent_events[0].checked_in).toBe(1);
  });

  it("consents report flags only old, unrevoked consents for minors", async () => {
    const minor = await createUser({
      congregationId: cong,
      cellGroupId: cell,
      role: "Student",
      email: "kid@dev.local",
      dateOfBirth: "2015-06-01",
    });
    await testPool().query(
      `INSERT INTO guardian_consents (user_id, guardian_name, guardian_contact, relationship, consent_text_version, granted_at)
       VALUES ($1, 'Mama', 'enc:x', 'mother', 'v1', now() - interval '12 months'),
              ($1, 'Baba', 'enc:y', 'father', 'v1', now() - interval '1 month')`,
      [minor.user_id],
    );
    const res = await agent().get("/v1/admin/reports/consents").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1); // only the 12-month-old one
    expect(res.body.data[0].guardian_name).toBe("Mama");
  });
});

describe("members administration", () => {
  it("lists members with search and band filters", async () => {
    const res = await agent().get("/v1/admin/members").set(auth(adminTok)).query({ search: "Test" });
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { user_id: string }) => m.user_id)).toContain(studentId);

    const none = await agent().get("/v1/admin/members").set(auth(adminTok)).query({ search: "zzz-no-match" });
    expect(none.body.data).toHaveLength(0);
  });

  it("adds a learner: creates a Student + L1 enrollment, audited", async () => {
    const res = await agent().post("/v1/admin/members").set(auth(adminTok)).send({
      full_name: "New Disciple",
      phone_number: "+254700000099",
      cell_group_id: cell,
    });
    expect(res.status).toBe(201);
    const enr = await testPool().query("SELECT current_level FROM enrollments WHERE user_id = $1", [res.body.user_id]);
    expect(enr.rows[0].current_level).toBe(1);
    const aud = await testPool().query("SELECT count(*)::int n FROM audit_log WHERE action = 'member.added'");
    expect(aud.rows[0].n).toBe(1);
  });

  it("persists the Figma member fields (gender/city/programme/country/language/baptized) and echoes them", async () => {
    const res = await agent().post("/v1/admin/members").set(auth(adminTok)).send({
      full_name: "Figma Disciple",
      phone_number: "+254700000077",
      cell_group_id: cell,
      gender: "female",
      city: "Nairobi",
      programme: "foundations",
      country_code: "ke", // lowercased input -> stored/returned uppercase
      language: "sw",
      is_baptized: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      gender: "female",
      city: "Nairobi",
      programme: "foundations",
      country_code: "KE",
      language: "sw",
      is_baptized: true,
    });
    // Band must NOT be settable from the modal even if sent.
    const withBand = await agent().post("/v1/admin/members").set(auth(adminTok)).send({
      full_name: "Mock Band",
      phone_number: "+254700000076",
      cell_group_id: cell,
      band: "thriving",
    });
    expect(withBand.status).toBe(400); // strict schema rejects unknown band key

    const list = await agent().get("/v1/admin/members").set(auth(adminTok)).query({ programme: "foundations" });
    const row = list.body.data.find((m: { user_id: string }) => m.user_id === res.body.user_id);
    expect(row).toMatchObject({ gender: "female", city: "Nairobi", programme: "foundations", country_code: "KE" });
    expect(row.status).toBe(null); // no engagement score yet, not graduated -> band is null
  });

  it("marks a member Graduated: list + profile status flip, then unmark restores band", async () => {
    // Give the seeded student a computed band so we can see graduated override it.
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.8, 0.8, 0.8, 0.8, 'thriving', CURRENT_DATE)`,
      [studentId, cell],
    );

    const before = await agent().get("/v1/admin/members").set(auth(adminTok));
    expect(before.body.data.find((m: { user_id: string }) => m.user_id === studentId).status).toBe("thriving");

    const grad = await agent().patch(`/v1/admin/members/${studentId}/graduation`).set(auth(adminTok)).send({ graduated: true });
    expect(grad.status).toBe(200);
    expect(grad.body).toMatchObject({ graduated: true, status: "graduated" });

    const afterList = await agent().get("/v1/admin/members").set(auth(adminTok));
    expect(afterList.body.data.find((m: { user_id: string }) => m.user_id === studentId).status).toBe("graduated");

    const profile = await agent().get(`/v1/admin/members/${studentId}`).set(auth(adminTok));
    expect(profile.body).toMatchObject({ status: "graduated", graduated: true });
    expect(profile.body.engagement.band).toBe("thriving"); // band still computed underneath

    const aud = await testPool().query("SELECT count(*)::int n FROM audit_log WHERE action = 'member.graduated'");
    expect(aud.rows[0].n).toBe(1);

    // Unmark -> status returns to the computed band.
    const ungrad = await agent().patch(`/v1/admin/members/${studentId}/graduation`).set(auth(adminTok)).send({ graduated: false });
    expect(ungrad.body).toMatchObject({ graduated: false, status: "thriving" });

    // Non-admin denied.
    const denied = await agent().patch(`/v1/admin/members/${studentId}/graduation`).set(auth(studentTok)).send({ graduated: true });
    expect(denied.status).toBe(403);
  });

  it("rejects an unknown cell and non-admin callers", async () => {
    const bad = await agent().post("/v1/admin/members").set(auth(adminTok)).send({
      full_name: "X",
      phone_number: "+254700000098",
      cell_group_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(bad.status).toBe(400);

    const forbidden = await agent().get("/v1/admin/members").set(auth(studentTok));
    expect(forbidden.status).toBe(403);
  });

  it("returns a single-member aggregate with metrics and nested sections", async () => {
    const res = await agent().get(`/v1/admin/members/${studentId}`).set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user_id: studentId });
    expect(res.body.enrollment.current_level).toBe(1);
    // Shape: metrics + collections always present (possibly empty/zero).
    expect(res.body.metrics).toMatchObject({
      habits_pct: expect.any(Number),
      curriculum_pct: expect.any(Number),
      attendance_pct: expect.any(Number),
    });
    expect(Array.isArray(res.body.certificates)).toBe(true);
    expect(Array.isArray(res.body.badges)).toBe(true);
    expect(Array.isArray(res.body.timeline)).toBe(true);
  });

  it("404s an unknown member and forbids non-admins", async () => {
    const missing = await agent().get("/v1/admin/members/00000000-0000-4000-8000-000000000000").set(auth(adminTok));
    expect(missing.status).toBe(404);

    const forbidden = await agent().get(`/v1/admin/members/${studentId}`).set(auth(studentTok));
    expect(forbidden.status).toBe(403);
  });

  it("edits an existing member (details + cell reassignment), audited; 404/403 guarded", async () => {
    const otherCell = await createCellGroup(cong, "Cell Beta");
    const upd = await agent().patch(`/v1/admin/members/${studentId}`).set(auth(adminTok)).send({
      full_name: "Renamed Member", city: "Mombasa", gender: "female", programme: "foundations",
      is_baptized: true, cell_group_id: otherCell,
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ full_name: "Renamed Member", city: "Mombasa", gender: "female", programme: "foundations", is_baptized: true, cell_group_id: otherCell });

    const detail = await agent().get(`/v1/admin/members/${studentId}`).set(auth(adminTok));
    expect(detail.body).toMatchObject({ full_name: "Renamed Member", city: "Mombasa", cell_group_id: otherCell });

    const missing = await agent().patch("/v1/admin/members/00000000-0000-4000-8000-000000000000").set(auth(adminTok)).send({ city: "X" });
    expect(missing.status).toBe(404);

    const forbidden = await agent().patch(`/v1/admin/members/${studentId}`).set(auth(studentTok)).send({ city: "X" });
    expect(forbidden.status).toBe(403);
  });

  it("synthesizes a notifications feed from real events (Admin); denies students", async () => {
    const res = await agent().get("/v1/admin/notifications").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // The seeded Student surfaces as a "New member added" feed item.
    const member = res.body.data.find((n: { id: string }) => n.id === `mbr-${studentId}`);
    expect(member).toMatchObject({ category: "info", href: "/members" });

    const denied = await agent().get("/v1/admin/notifications").set(auth(studentTok));
    expect(denied.status).toBe(403);
  });

  it("persists per-admin notification read + dismiss state across requests", async () => {
    const before = await agent().get("/v1/admin/notifications").set(auth(adminTok));
    const item = before.body.data.find((n: { id: string }) => n.id === `mbr-${studentId}`);
    expect(item.read).toBe(false);

    // Mark read → reflected on the next fetch.
    const marked = await agent().post("/v1/admin/notifications/read").set(auth(adminTok)).send({ ids: [`mbr-${studentId}`] });
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ updated: 1 });
    const afterRead = await agent().get("/v1/admin/notifications").set(auth(adminTok));
    expect(afterRead.body.data.find((n: { id: string }) => n.id === `mbr-${studentId}`).read).toBe(true);

    // Dismiss → drops out of the feed entirely.
    await agent().post("/v1/admin/notifications/dismiss").set(auth(adminTok)).send({ ids: [`mbr-${studentId}`] });
    const afterDismiss = await agent().get("/v1/admin/notifications").set(auth(adminTok));
    expect(afterDismiss.body.data.some((n: { id: string }) => n.id === `mbr-${studentId}`)).toBe(false);

    const badAction = await agent().post("/v1/admin/notifications/bogus").set(auth(adminTok)).send({ ids: [] });
    expect(badAction.status).toBe(404);
  });
});

describe("cells administration", () => {
  it("registers a new cell (Admin), echoes metadata, and surfaces it in the engagement report", async () => {
    const res = await agent().post("/v1/admin/cells").set(auth(adminTok)).send({
      name: "Lakeview Cell", discipler_name: "Mary Wanjiru", discipler_role: "Lead discipler",
      focus: "New believers", level_label: "Level 2 · Foundations", meets: "Tue · 6:30 PM",
      room: "Hall B", next_session: "Tue, Jun 24 · 6:30 PM", tone: "amber",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Lakeview Cell");
    expect(res.body.discipler_name).toBe("Mary Wanjiru");
    expect(res.body.tone).toBe("amber");
    expect(res.body.members).toBe(0); // fresh cell — metrics derived, no disciples yet

    const report = await agent().get("/v1/admin/reports/engagement").set(auth(adminTok));
    const row = (report.body.cells as { name: string; focus: string | null }[]).find((c) => c.name === "Lakeview Cell");
    expect(row).toBeTruthy();
    expect(row?.focus).toBe("New believers");
  });

  it("rejects a duplicate cell name (409) and non-admin callers (403)", async () => {
    await agent().post("/v1/admin/cells").set(auth(adminTok)).send({ name: "Unique Cell" });
    const dup = await agent().post("/v1/admin/cells").set(auth(adminTok)).send({ name: "unique cell" });
    expect(dup.status).toBe(409);

    const forbidden = await agent().post("/v1/admin/cells").set(auth(studentTok)).send({ name: "Hacker Cell" });
    expect(forbidden.status).toBe(403);
  });
});

describe("homepage-featured cell (\"This week at Nuru\", single-row invariant)", () => {
  it("features a cell, enforces a single featured cell, and reflects it in the engagement report", async () => {
    // `cell` (from beforeEach) plus a second cell.
    const cellB = await createCellGroup(cong, "Second Cell");

    const set = await agent().post(`/v1/admin/cells/${cell}/homepage`).set(auth(adminTok));
    expect(set.status).toBe(200);
    expect(set.body.is_featured).toBe(true);

    let on = await testPool().query("SELECT cell_group_id FROM cell_groups WHERE is_featured = true");
    expect(on.rowCount).toBe(1);
    expect(on.rows[0].cell_group_id).toBe(cell);

    // Featuring the second cell unsets the first — never two featured rows.
    const set2 = await agent().post(`/v1/admin/cells/${cellB}/homepage`).set(auth(adminTok));
    expect(set2.status).toBe(200);
    on = await testPool().query("SELECT cell_group_id FROM cell_groups WHERE is_featured = true");
    expect(on.rowCount).toBe(1);
    expect(on.rows[0].cell_group_id).toBe(cellB);

    // Engagement report carries is_featured per cell.
    const report = await agent().get("/v1/admin/reports/engagement").set(auth(adminTok));
    const rows = report.body.cells as { cell_group_id: string; is_featured: boolean }[];
    expect(rows.find((c) => c.cell_group_id === cellB)?.is_featured).toBe(true);
    expect(rows.find((c) => c.cell_group_id === cell)?.is_featured).toBe(false);
  });

  it("clears the featured cell", async () => {
    await agent().post(`/v1/admin/cells/${cell}/homepage`).set(auth(adminTok));
    const clear = await agent().delete(`/v1/admin/cells/${cell}/homepage`).set(auth(adminTok));
    expect(clear.status).toBe(200);
    expect(clear.body.is_featured).toBe(false);
    const on = await testPool().query("SELECT 1 FROM cell_groups WHERE is_featured = true");
    expect(on.rowCount).toBe(0);
  });

  it("GET /home/featured-cell returns the cell summary (with member count + avg engagement) or null", async () => {
    // Unset → null.
    const none = await agent().get("/v1/home/featured-cell").set(auth(studentTok));
    expect(none.status).toBe(200);
    expect(none.body).toBeNull();

    // A member with an engagement score in the cell feeds the derived metrics.
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.7, 0.7, 0.7, 0.7, 'thriving', CURRENT_DATE)`,
      [studentId, cell],
    );
    await agent().post(`/v1/admin/cells/${cell}/homepage`).set(auth(adminTok));

    const res = await agent().get("/v1/home/featured-cell").set(auth(studentTok));
    expect(res.status).toBe(200);
    expect(res.body.cell_group_id).toBe(cell);
    expect(res.body.members).toBe(1);
    expect(typeof res.body.avg_engagement).toBe("number");
  });

  it("forbids non-admin callers (403) and 404s an unknown cell", async () => {
    const forbidden = await agent().post(`/v1/admin/cells/${cell}/homepage`).set(auth(studentTok));
    expect(forbidden.status).toBe(403);

    const missing = await agent()
      .post("/v1/admin/cells/00000000-0000-0000-0000-000000000000/homepage")
      .set(auth(adminTok));
    expect(missing.status).toBe(404);
  });
});

describe("audit viewer (SuperAdmin)", () => {
  it("lists audit rows for SuperAdmin; Admin gets 403", async () => {
    await agent().post("/v1/admin/members").set(auth(adminTok)).send({
      full_name: "For Audit",
      phone_number: "+254700000097",
      cell_group_id: cell,
    });
    const res = await agent().get("/v1/admin/audit").set(auth(superTok)).query({ action: "member" });
    expect(res.status).toBe(200);
    expect(res.body.data[0].action).toBe("member.added");

    const denied = await agent().get("/v1/admin/audit").set(auth(adminTok));
    expect(denied.status).toBe(403);
  });
});

describe("certificates register", () => {
  it("manually issues, lists, revokes (reason required) — and verify flips invalid", async () => {
    const issued = await agent().post("/v1/admin/certificates").set(auth(adminTok)).send({ user_id: studentId, level_number: 1 });
    expect(issued.status).toBe(201);
    const code = issued.body.verification_code as string;

    const okVerify = await agent().get(`/v1/verify/${code}`);
    expect(okVerify.body).toMatchObject({ valid: true, revoked: false });

    const list = await agent().get("/v1/admin/certificates").set(auth(adminTok));
    expect(list.body.data).toHaveLength(1);
    const certId = list.body.data[0].certificate_id;

    const noReason = await agent().post(`/v1/admin/certificates/${certId}/revoke`).set(auth(adminTok)).send({});
    expect(noReason.status).toBe(400);

    const revoked = await agent()
      .post(`/v1/admin/certificates/${certId}/revoke`)
      .set(auth(adminTok))
      .send({ reason: "Issued to the wrong member" });
    expect(revoked.status).toBe(200);

    const badVerify = await agent().get(`/v1/verify/${code}`);
    expect(badVerify.body).toMatchObject({ valid: false, revoked: true });

    const again = await agent()
      .post(`/v1/admin/certificates/${certId}/revoke`)
      .set(auth(adminTok))
      .send({ reason: "twice" });
    expect(again.status).toBe(404); // already revoked
  });
});

describe("finance reads", () => {
  beforeEach(async () => {
    const fund = await testPool().query(`SELECT fund_id FROM funds WHERE code = 'tithe'`);
    const txn = await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key, settled_at)
       VALUES ($1, $2, 50000, 'KES', 'succeeded', 'k1', now()) RETURNING transaction_id`,
      [studentId, fund.rows[0].fund_id],
    );
    await testPool().query(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
       VALUES ($1, 'cash:stripe', 'debit', 50000, 'KES'), ($1, 'fund:tithe', 'credit', 50000, 'KES')`,
      [txn.rows[0].transaction_id],
    );
  });

  it("summary shows per-fund settled revenue", async () => {
    const res = await agent().get("/v1/admin/finance/summary").set(auth(adminTok));
    expect(res.status).toBe(200);
    const tithe = res.body.funds.find((f: { code: string }) => f.code === "tithe");
    expect(tithe.total_minor).toBe(50000);
    expect(tithe.month_minor).toBe(50000);
  });

  it("transactions + ledger registers read; Student gets 403", async () => {
    const txns = await agent().get("/v1/admin/finance/transactions").set(auth(adminTok)).query({ fund: "tithe" });
    expect(txns.body.data).toHaveLength(1);
    expect(txns.body.data[0].amount_minor).toBe(50000);

    const ledger = await agent().get("/v1/admin/finance/ledger").set(auth(adminTok));
    expect(ledger.body.data).toHaveLength(2); // balanced pair

    const denied = await agent().get("/v1/admin/finance/summary").set(auth(studentTok));
    expect(denied.status).toBe(403);
  });
});
