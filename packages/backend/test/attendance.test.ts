// Attendance check-in — scan-token validation + idempotency (§3.3).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEvent } from "./helpers/factories.js";
import { AttendanceService, eventScanToken } from "../src/modules/progress/attendance.js";

const svc = () => new AttendanceService(testPool());
const SCAN = "11111111-1111-4111-8111-111111111111";

describe("attendance check-in (§3.3)", () => {
  let user: string, eventId: string, token: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    user = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    const ev = await createEvent(cong, { eventId: "svc-1", qrSecret: "s3cr3t", cellGroupId: cell });
    eventId = ev.event_id;
    token = eventScanToken("s3cr3t", eventId);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("records a valid check-in", async () => {
    const res = await svc().checkIn(user, eventId, { client_scan_id: SCAN, scan_token: token });
    expect(res.duplicate).toBe(false);
    const ob = await testPool().query("SELECT count(*)::int n FROM outbox WHERE topic='engagement.recompute'");
    expect(ob.rows[0].n).toBe(1); // nudges Aᵢ recompute
  });

  it("is idempotent on a re-scan", async () => {
    const first = await svc().checkIn(user, eventId, { client_scan_id: SCAN, scan_token: token });
    const again = await svc().checkIn(user, eventId, { client_scan_id: SCAN, scan_token: token });
    expect(again.duplicate).toBe(true);
    expect(again.attendance_id).toBe(first.attendance_id);
  });

  it("rejects a forged scan token", async () => {
    await expect(
      svc().checkIn(user, eventId, { client_scan_id: SCAN, scan_token: "forged" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("404s an unknown event", async () => {
    await expect(
      svc().checkIn(user, "no-such-event", { client_scan_id: SCAN, scan_token: token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
