// Notifications (spec §1.5). Schedules push/email nudges, honouring each member's
// quiet hours (local timezone) and a daily cap. Driven by the outbox (level
// completion, giving receipts) and, later, the inactivity scanner that paces the
// 12-nudge cadence. Sending is delegated to PUSH_PROVIDER dispatch (out of scope
// here); this owns the scheduling decision.
import type { Pool } from "pg";
import { maybeOne, one, audit } from "../../db/db.js";

export interface NotifPrefs {
  push_enabled: boolean;
  email_enabled: boolean;
  quiet_from: string; // 'HH:MM[:SS]'
  quiet_to: string;
  max_daily: number;
}

const DEFAULT_PREFS: NotifPrefs = {
  push_enabled: true,
  email_enabled: true,
  quiet_from: "21:00",
  quiet_to: "07:00",
  max_daily: 3,
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** Local minute-of-day for an instant in a timezone (no tz library needed). */
export function localMinuteOfDay(atMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * The instant to send at: `at` unless it falls inside the quiet window, in which
 * case it is pushed to the window's end (wrap-around aware, e.g. 21:00→07:00).
 */
export function nextSendTime(atMs: number, timezone: string, quietFrom: string, quietTo: string): Date {
  const localM = localMinuteOfDay(atMs, timezone);
  const fromM = toMinutes(quietFrom);
  const toM = toMinutes(quietTo);
  const spansMidnight = fromM > toM;
  const inQuiet = spansMidnight ? localM >= fromM || localM < toM : localM >= fromM && localM < toM;
  if (!inQuiet) return new Date(atMs);
  const deltaMin = spansMidnight ? (toM - localM + 1440) % 1440 : toM - localM;
  return new Date(atMs + deltaMin * 60_000);
}

export class NotificationService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async prefs(userId: string): Promise<NotifPrefs> {
    const row = await maybeOne<NotifPrefs>(
      this.pool,
      `SELECT push_enabled, email_enabled, quiet_from::text AS quiet_from, quiet_to::text AS quiet_to, max_daily
         FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return row ?? DEFAULT_PREFS;
  }

  /**
   * Schedule a nudge. Returns the persisted row; status is 'suppressed' when the
   * channel is off or the daily cap is hit, otherwise 'scheduled' at a time that
   * respects quiet hours.
   */
  async schedule(input: {
    userId: string;
    channel: "push" | "email";
    template: string;
    payload?: Record<string, unknown>;
    timezone?: string;
  }): Promise<{ notification_id: string; status: string; scheduled_for: string }> {
    const prefs = await this.prefs(input.userId);
    const channelEnabled = input.channel === "push" ? prefs.push_enabled : prefs.email_enabled;

    // Count "today" by the SAME clock the scheduler uses (injectable in tests) —
    // mixing the DB's now() with this.now() makes the cap silently miscount.
    const dayCount = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM notifications
        WHERE user_id = $1 AND status <> 'suppressed'
          AND scheduled_for::date = ($2::timestamptz AT TIME ZONE 'UTC')::date`,
      [input.userId, new Date(this.now()).toISOString()],
    );

    const tz = input.timezone ?? "Africa/Nairobi";
    const when = nextSendTime(this.now(), tz, prefs.quiet_from, prefs.quiet_to);
    const suppressed = !channelEnabled || dayCount.n >= prefs.max_daily;

    const row = await one<{ notification_id: string; status: string; scheduled_for: string }>(
      this.pool,
      `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING notification_id, status, scheduled_for`,
      [
        input.userId,
        input.channel,
        input.template,
        JSON.stringify(input.payload ?? {}),
        suppressed ? "suppressed" : "scheduled",
        when.toISOString(),
      ],
    );
    await audit(this.pool, input.userId, "notification.scheduled", "notifications", row.notification_id, {
      template: input.template,
      status: row.status,
    });
    return row;
  }
}
