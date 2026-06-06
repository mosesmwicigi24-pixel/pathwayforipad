// Attendance check-in (spec §3.3, §5). A member scans an event QR whose token is
// an HMAC of the event's qr_secret; the server validates it (so a screenshot of a
// generic code can't forge attendance), records the check-in idempotently
// (client_scan_id / one-per-event), and nudges an engagement recompute (Aᵢ, §1.8).
import type { Pool } from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { maybeOne, one, tx, enqueueOutbox, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

/** The token a valid event QR encodes. Stable per event; rotate qr_secret to invalidate. */
export function eventScanToken(qrSecret: string, eventId: string): string {
  return createHmac("sha256", qrSecret).update(eventId).digest("hex");
}

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface CheckInResult {
  attendance_id: string;
  duplicate: boolean;
}

export class AttendanceService {
  constructor(private readonly pool: Pool) {}

  async checkIn(
    userId: string,
    eventId: string,
    input: { client_scan_id: string; scan_token: string },
  ): Promise<CheckInResult> {
    return tx(this.pool, async (c) => {
      const event = await maybeOne<{ qr_secret: string }>(
        c,
        `SELECT qr_secret FROM events WHERE event_id = $1`,
        [eventId],
      );
      if (!event) throw new ApiError("NOT_FOUND", "Event not found");
      if (!tokensMatch(eventScanToken(event.qr_secret, eventId), input.scan_token)) {
        throw new ApiError("VALIDATION_FAILED", "Invalid or expired scan token");
      }

      // Idempotent: a replayed scan, or a second scan of the same event, is a no-op.
      const row = await maybeOne<{ attendance_id: string }>(
        c,
        `INSERT INTO attendance_logs (user_id, event_id, client_scan_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING attendance_id`,
        [userId, eventId, input.client_scan_id],
      );
      if (!row) {
        const existing = await one<{ attendance_id: string }>(
          c,
          `SELECT attendance_id FROM attendance_logs WHERE user_id = $1 AND event_id = $2`,
          [userId, eventId],
        );
        return { attendance_id: existing.attendance_id, duplicate: true };
      }

      await enqueueOutbox(c, "engagement.recompute", { user_id: userId });
      await enqueueOutbox(c, "gamification.evaluate", { user_id: userId });
      await audit(c, userId, "attendance.checked_in", "events", eventId, {});
      return { attendance_id: row.attendance_id, duplicate: false };
    });
  }
}
