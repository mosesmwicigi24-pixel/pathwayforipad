// Video service (Features v2 §V). Admin upload sessions (server signs, never
// proxies bytes), transcode orchestration via the provider abstraction, gated
// HLS manifest issuance (the §1.9 hard-lock extends to video), and cross-device
// resume positions (LWW, offline-synced). All server-authoritative.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, isModuleUnlocked } from "../progress/gating.js";
import type { MediaService } from "./service.js";
import type { VideoPipelineProvider } from "./pipeline.js";

const MANIFEST_TTL = 600; // ≤ 10 min (§V.2)
const DEFAULT_MAX_BYTES = 2_000_000_000; // 2 GB upload cap

export class VideoService {
  constructor(
    private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly pipeline: VideoPipelineProvider,
  ) {}

  // ---------------- Admin: uploads ----------------

  static readonly CreateUpload = z
    .object({
      kind: z.enum(["lesson_video", "vod", "product"]).default("lesson_video"),
      mime_allowed: z.string().default("video/mp4"),
      byte_size_max: z.number().int().positive().max(10_000_000_000).optional(),
    })
    .strict();

  async createUploadSession(
    adminId: string,
    input: z.infer<typeof VideoService.CreateUpload>,
  ): Promise<{ upload_id: string; media_asset_id: string; signed_put_url: string; max_bytes: number; mime_allowed: string }> {
    const maxBytes = input.byte_size_max ?? DEFAULT_MAX_BYTES;
    const kind = input.kind ?? "lesson_video";
    const mimeAllowed = input.mime_allowed ?? "video/mp4";
    return tx(this.pool, async (c) => {
      const asset = await one<{ media_asset_id: string }>(
        c,
        `INSERT INTO media_assets (cloudinary_id, kind, status, provider, created_by)
         VALUES ('pending', $1, 'uploading', $2, $3) RETURNING media_asset_id`,
        [kind, this.pipeline.name, adminId],
      );
      const sourceKey = `media/uploads/${asset.media_asset_id}.mp4`;
      await c.query(`UPDATE media_assets SET source_object_key = $1 WHERE media_asset_id = $2`, [
        sourceKey,
        asset.media_asset_id,
      ]);
      const signed = this.media.signedUploadUrl(sourceKey);
      const up = await one<{ upload_id: string }>(
        c,
        `INSERT INTO video_uploads (media_asset_id, created_by, put_url_expiry, byte_size_max, mime_allowed)
         VALUES ($1,$2,$3,$4,$5) RETURNING upload_id`,
        [asset.media_asset_id, adminId, signed.expires_at, maxBytes, mimeAllowed],
      );
      await audit(c, adminId, "media.upload_session", "media_assets", asset.media_asset_id, { kind });
      return {
        upload_id: up.upload_id,
        media_asset_id: asset.media_asset_id,
        signed_put_url: signed.url,
        max_bytes: maxBytes,
        mime_allowed: mimeAllowed,
      };
    });
  }

  static readonly CompleteUpload = z.object({ content_hash: z.string().length(64).optional() }).strict();

  /** Mark uploaded + enqueue transcode. Idempotent: re-complete is a no-op. */
  async completeUpload(
    adminId: string,
    uploadId: string,
    input: z.infer<typeof VideoService.CompleteUpload>,
  ): Promise<{ media_asset_id: string; status: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      const up = await maybeOne<{ media_asset_id: string; completed_at: string | null; source_object_key: string | null }>(
        c,
        `SELECT vu.media_asset_id, vu.completed_at, m.source_object_key
           FROM video_uploads vu JOIN media_assets m ON m.media_asset_id = vu.media_asset_id
          WHERE vu.upload_id = $1 FOR UPDATE OF vu`,
        [uploadId],
      );
      if (!up) throw new ApiError("NOT_FOUND", "Upload session not found");
      if (up.completed_at) {
        return { media_asset_id: up.media_asset_id, status: "transcoding", duplicate: true };
      }
      const contentHash =
        input.content_hash ?? createHash("sha256").update(up.source_object_key ?? up.media_asset_id).digest("hex");
      await c.query(`UPDATE video_uploads SET completed_at = now() WHERE upload_id = $1`, [uploadId]);
      await c.query(`UPDATE media_assets SET status = 'transcoding', content_hash = $2 WHERE media_asset_id = $1`, [
        up.media_asset_id,
        contentHash,
      ]);
      await enqueueOutbox(c, "media.transcode", { media_asset_id: up.media_asset_id, content_hash: contentHash });
      await audit(c, adminId, "media.upload_complete", "media_assets", up.media_asset_id, {});
      return { media_asset_id: up.media_asset_id, status: "transcoding", duplicate: false };
    });
  }

  /** Worker handler for outbox topic media.transcode. Idempotent on (asset, content_hash). */
  async transcodeAsset(payload: { media_asset_id: string; content_hash: string }): Promise<void> {
    const asset = await maybeOne<{ status: string; source_object_key: string | null; content_hash: string | null }>(
      this.pool,
      `SELECT status, source_object_key, content_hash FROM media_assets WHERE media_asset_id = $1`,
      [payload.media_asset_id],
    );
    if (!asset) return;
    if (asset.status === "ready" && asset.content_hash === payload.content_hash) return; // already done
    try {
      const result = await this.pipeline.transcode({
        mediaAssetId: payload.media_asset_id,
        sourceObjectKey: asset.source_object_key ?? "",
        contentHash: payload.content_hash,
      });
      await this.pool.query(
        `UPDATE media_assets
            SET status = 'ready', hls_master_key = $2, ladder = $3, provider = $4, error_detail = NULL
          WHERE media_asset_id = $1`,
        [payload.media_asset_id, result.hlsMasterKey, JSON.stringify(result.ladder), this.pipeline.name],
      );
    } catch (e) {
      await this.pool.query(`UPDATE media_assets SET status = 'failed', error_detail = $2 WHERE media_asset_id = $1`, [
        payload.media_asset_id,
        e instanceof Error ? e.message : "transcode failed",
      ]);
      throw e;
    }
  }

  /** Video Library (W2): all managed assets, newest first, with the linked
   *  module title and a stuck-encoding flag (transcoding for > 30 min). */
  async listAssets(): Promise<{ data: unknown[]; total: number; stuck: number }> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT ma.media_asset_id, ma.kind, ma.status, ma.provider, ma.duration_sec,
              ma.error_detail, ma.created_at,
              m.title AS attached_module_title, m.module_id AS attached_module_id,
              (ma.status = 'transcoding' AND ma.created_at < now() - interval '30 minutes') AS is_stuck
         FROM media_assets ma
         LEFT JOIN modules m ON m.media_asset_id = ma.media_asset_id
        ORDER BY ma.created_at DESC
        LIMIT 200`,
    );
    return {
      data: rows,
      total: rows.length,
      stuck: rows.filter((r) => r.is_stuck === true).length,
    };
  }

  getAsset(id: string): Promise<unknown> {
    return maybeOne(
      this.pool,
      `SELECT media_asset_id, kind, status, provider, ladder, duration_sec, hls_master_key, error_detail, created_at
         FROM media_assets WHERE media_asset_id = $1`,
      [id],
    ).then((row) => {
      if (!row) throw new ApiError("NOT_FOUND", "Media asset not found");
      return row;
    });
  }

  /** Archive an asset; refuse if a PUBLISHED module still references it. */
  async archiveAsset(adminId: string, id: string): Promise<{ archived: boolean }> {
    return tx(this.pool, async (c) => {
      const refs = await one<{ n: number }>(
        c,
        `SELECT COUNT(*)::int AS n FROM modules WHERE media_asset_id = $1 AND status = 'published'`,
        [id],
      );
      if (refs.n > 0) {
        throw new ApiError("CONFLICT", "Asset is referenced by a published module; unpublish first");
      }
      const r = await c.query(`UPDATE media_assets SET status = 'failed', error_detail = 'archived' WHERE media_asset_id = $1`, [id]);
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Media asset not found");
      await audit(c, adminId, "media.archived", "media_assets", id, {});
      return { archived: true };
    });
  }

  // ---------------- Member: gated manifest ----------------

  /** Signed, expiring HLS master URL. 404 if not ready; 409 GATE_LOCKED if the owning module is locked. */
  async manifest(userId: string, mediaAssetId: string): Promise<{ url: string; expires_at: string }> {
    const asset = await maybeOne<{ status: string; hls_master_key: string | null }>(
      this.pool,
      `SELECT status, hls_master_key FROM media_assets WHERE media_asset_id = $1`,
      [mediaAssetId],
    );
    if (!asset || asset.status !== "ready" || !asset.hls_master_key) {
      throw new ApiError("NOT_FOUND", "Media asset not available");
    }
    // If a published module owns this asset, the §1.9 hard-lock applies.
    const owning = await maybeOne<{ module_id: string; level_number: number; module_sequence_number: number }>(
      this.pool,
      `SELECT module_id, level_number, module_sequence_number
         FROM modules WHERE media_asset_id = $1 AND status = 'published'
        ORDER BY level_number, module_sequence_number LIMIT 1`,
      [mediaAssetId],
    );
    if (owning) {
      const enrollment = await loadEnrollment(this.pool, userId);
      if (!enrollment || !(await isModuleUnlocked(this.pool, enrollment, owning))) {
        throw new ApiError("GATE_LOCKED", "Video is not yet unlocked", {
          module_sequence_number: owning.module_sequence_number,
        });
      }
    }
    return this.media.signedUrl(asset.hls_master_key, MANIFEST_TTL);
  }

  // ---------------- Sync: cross-device resume (LWW) ----------------

  async upsertProgress(
    userId: string,
    p: { media_asset_id: string; position_sec: number; completed_pct: number; client_mutation_id?: string },
    c: Queryable = this.pool,
  ): Promise<{ duplicate: boolean }> {
    const existing = await maybeOne<{ client_mutation_id: string | null }>(
      c,
      `SELECT client_mutation_id FROM video_progress WHERE user_id = $1 AND media_asset_id = $2`,
      [userId, p.media_asset_id],
    );
    if (p.client_mutation_id && existing?.client_mutation_id === p.client_mutation_id) {
      return { duplicate: true };
    }
    // LWW: a later write simply overwrites (convenience state, §V.0).
    await c.query(
      `INSERT INTO video_progress (user_id, media_asset_id, position_sec, completed_pct, client_mutation_id, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (user_id, media_asset_id) DO UPDATE
         SET position_sec = EXCLUDED.position_sec,
             completed_pct = EXCLUDED.completed_pct,
             client_mutation_id = EXCLUDED.client_mutation_id,
             updated_at = now()`,
      [userId, p.media_asset_id, Math.max(0, p.position_sec | 0), p.completed_pct, p.client_mutation_id ?? null],
    );
    await recordChange(c, "video_progress", p.media_asset_id, userId, "upsert");
    return { duplicate: false };
  }

  listProgress(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT media_asset_id, position_sec, completed_pct, updated_at FROM video_progress WHERE user_id = $1`,
      [userId],
    );
  }
}
