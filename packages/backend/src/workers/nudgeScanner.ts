// Inactivity / re-engagement nudge cadence (spec §1.5). Finds members whose
// latest engagement snapshot is in the watch/at_risk bands and schedules a
// re-engagement nudge — unless one was already scheduled in the recent window, so
// the cadence paces itself rather than nudging every run. Per-day volume + quiet
// hours are enforced downstream by NotificationService.
import type { Pool } from "pg";
import type { Logger } from "pino";
import { many } from "../db/db.js";
import type { NotificationService } from "../modules/notifications/service.js";

export class NudgeScanner {
  constructor(
    private readonly pool: Pool,
    private readonly notifications: NotificationService,
    private readonly log?: Logger,
    private readonly cooldownHours = 72,
  ) {}

  /** Schedule re-engagement nudges for stalling members not nudged recently. */
  async scanOnce(): Promise<{ nudged: number }> {
    const due = await many<{ user_id: string; timezone: string }>(
      this.pool,
      `SELECT es.user_id, u.timezone
         FROM engagement_scores es JOIN users u ON u.user_id = es.user_id
        WHERE es.band IN ('watch', 'at_risk')
          AND u.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id = es.user_id AND n.template = 'reengage'
               AND n.scheduled_for > now() - ($1 || ' hours')::interval
          )`,
      [String(this.cooldownHours)],
    );

    for (const m of due) {
      await this.notifications.schedule({
        userId: m.user_id,
        channel: "push",
        template: "reengage",
        timezone: m.timezone,
      });
    }
    if (due.length > 0) this.log?.info({ nudged: due.length }, "re-engagement nudges scheduled");
    return { nudged: due.length };
  }

  start(intervalMs = 60 * 60 * 1000): () => void {
    const timer = setInterval(() => {
      void this.scanOnce().catch((err) => this.log?.error({ err }, "nudge scan crashed"));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
  }
}
