// Notification dispatch worker (spec §1.5). Drains due scheduled notifications,
// resolves the recipient (push token or email), sends via the provider, and marks
// sent/failed. Claims with FOR UPDATE OF n + SKIP LOCKED so multiple workers are
// safe; sends inside the row's tx (notif_status has no 'processing' state).
import type { Pool } from "pg";
import type { Logger } from "pino";
import { many, maybeOne, tx } from "../db/db.js";
import type { DispatchProvider } from "./dispatch.js";

export class NotificationWorker {
  constructor(
    private readonly pool: Pool,
    private readonly provider: DispatchProvider,
    private readonly log?: Logger,
    private readonly batchSize = 50,
  ) {}

  async dispatchDue(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    await tx(this.pool, async (c) => {
      const rows = await many<{
        notification_id: string;
        user_id: string;
        channel: "push" | "email";
        template: string;
        payload: Record<string, unknown>;
        email: string | null;
      }>(
        c,
        `SELECT n.notification_id, n.user_id, n.channel, n.template, n.payload, u.email
           FROM notifications n JOIN users u ON u.user_id = n.user_id
          WHERE n.status = 'scheduled' AND n.scheduled_for <= now()
          ORDER BY n.scheduled_for
          FOR UPDATE OF n SKIP LOCKED
          LIMIT $1`,
        [this.batchSize],
      );

      for (const r of rows) {
        try {
          const to =
            r.channel === "email"
              ? r.email
              : (
                  await maybeOne<{ token: string }>(
                    c,
                    `SELECT token FROM push_tokens WHERE user_id = $1 AND is_active ORDER BY updated_at DESC LIMIT 1`,
                    [r.user_id],
                  )
                )?.token ?? null;

          if (!to) {
            await c.query(`UPDATE notifications SET status = 'failed' WHERE notification_id = $1`, [r.notification_id]);
            failed += 1;
            continue;
          }
          await this.provider.send({ channel: r.channel, to, template: r.template, payload: r.payload });
          await c.query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE notification_id = $1`, [
            r.notification_id,
          ]);
          sent += 1;
        } catch (err) {
          await c.query(`UPDATE notifications SET status = 'failed' WHERE notification_id = $1`, [r.notification_id]);
          failed += 1;
          this.log?.error({ err, notification_id: r.notification_id }, "notification dispatch failed");
        }
      }
    });
    return { sent, failed };
  }

  start(intervalMs = 10_000): () => void {
    const timer = setInterval(() => {
      void this.dispatchDue().catch((err) => this.log?.error({ err }, "notification drain crashed"));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
  }
}
