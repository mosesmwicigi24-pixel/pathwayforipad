// Outbox topic → handler registry (spec §1.6). Each handler is idempotent so an
// at-least-once redelivery is safe. New asynchronous side effects (notifications,
// media renders) register here as their modules land.
import type { AppContext } from "../http/context.js";
import { CertificateService } from "../modules/certificates/service.js";
import { InMemoryObjectStore } from "../modules/certificates/objectStore.js";
import { EngagementService } from "../modules/engagement/service.js";
import { NotificationService } from "../modules/notifications/service.js";
import { MediaService } from "../modules/media/service.js";
import { VideoService } from "../modules/media/video.js";
import { buildVideoPipeline } from "../modules/media/pipeline.js";
import { CalendarService } from "../modules/calendar/service.js";
import { GamificationService } from "../modules/gamification/service.js";
import type { OutboxHandler } from "./outbox.js";

export function buildOutboxHandlers(ctx: AppContext): Map<string, OutboxHandler> {
  // Cert PDFs render to an object store; swap InMemoryObjectStore → S3/Cloudinary
  // in production.
  const certs = new CertificateService(
    ctx.db.primary,
    ctx.env.CERT_SIGNING_KEY ?? ctx.env.JWT_SIGNING_KEY,
    new InMemoryObjectStore(),
  );
  const engagement = new EngagementService(ctx.db.primary);
  const notifications = new NotificationService(ctx.db.primary);
  const video = new VideoService(ctx.db.primary, new MediaService(ctx.env.CLOUDINARY_URL), buildVideoPipeline(ctx.env));

  const handlers = new Map<string, OutboxHandler>();

  // Features v2 §V.3: transcode a completed upload (idempotent on asset+content_hash).
  handlers.set("media.transcode", async (p) => {
    await video.transcodeAsset({ media_asset_id: String(p.media_asset_id), content_hash: String(p.content_hash) });
  });

  // Features v2 §C.3: materialize a series' occurrences into events (idempotent).
  const calendar = new CalendarService(ctx.db.primary, ctx.env.CAL_MATERIALIZE_HORIZON_DAYS, ctx.env.CAL_MAX_INSTANCES);
  handlers.set("calendar.materialize", async (p) => {
    await calendar.materialize(String(p.series_id));
  });

  // Features v2 §G.3: re-evaluate the badge catalog against a member's verified
  // stats on a high-signal event; award notification + the award itself.
  const gamification = new GamificationService(ctx.db.primary);
  handlers.set("gamification.evaluate", async (p) => {
    await gamification.evaluateForUser(String(p.user_id));
  });
  handlers.set("notification.badge_awarded", async (p) => {
    await notifications.schedule({
      userId: String(p.user_id ?? ""),
      channel: "push",
      template: "badge_awarded",
      payload: p,
    });
  });

  // Flow B: an approved reflection enqueues this; issue the level credential.
  handlers.set("certificate.issue", async (p) => {
    await certs.issue(String(p.user_id), p.level_number == null ? null : Number(p.level_number));
  });

  // High-signal events trigger a single-member engagement refresh (§1.8).
  handlers.set("engagement.recompute", async (p) => {
    await engagement.recomputeOne(String(p.user_id));
  });

  // Member-facing nudges (§1.5), quiet-hours + daily-cap aware.
  handlers.set("notification.level_completed", async (p) => {
    await notifications.schedule({
      userId: String(p.user_id),
      channel: "push",
      template: "level_completed",
      payload: p,
    });
  });
  handlers.set("giving.receipt", async (p) => {
    await notifications.schedule({
      userId: String(p.user_id ?? ""),
      channel: "email",
      template: "giving_receipt",
      payload: p,
    });
  });

  return handlers;
}
