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

// External (shareable) origins vs. hosted (signed-delivery) origins. External
// links are best-effort gated only — they're shareable by nature (§ product
// decision); hosted sources go through the existing signed-URL broker.
const EXTERNAL_SOURCES = new Set(["youtube", "vimeo", "direct", "private"]);

/** Parse a YouTube/Vimeo video id from a pasted URL (server-side). */
export function parseExternalVideo(
  declared: "youtube" | "vimeo" | "direct" | "private",
  raw: string,
): { videoId: string | null } {
  const url = raw.trim();
  if (declared === "youtube") {
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return { videoId: yt ? (yt[1] ?? null) : null };
  }
  if (declared === "vimeo") {
    const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return { videoId: vm ? (vm[1] ?? null) : null };
  }
  return { videoId: null }; // direct / private carry no provider id
}

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

  static readonly ListFilter = z
    .object({
      status: z.enum(["uploading", "transcoding", "ready", "failed"]).optional(),
      video_source: z.enum(["cloudinary", "youtube", "vimeo", "direct", "private"]).optional(),
      level: z.coerce.number().int().optional(),
      attached: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional(),
      q: z.string().trim().min(1).optional(),
    })
    .strict();

  /** Video Library (W2 / Figma VideoLibrary): managed assets, newest first, with
   *  the linked module title, a stuck-encoding flag (transcoding for > 30 min),
   *  the external/library fields, and cheap derived views/completion from
   *  video_progress. Optional filters: status, video_source, level, attached, q. */
  async listAssets(
    filter: z.infer<typeof VideoService.ListFilter> = {},
  ): Promise<{ data: unknown[]; total: number; stuck: number }> {
    // Deleted (archived) assets are never listed — they vanish from the library
    // AND the processing queue, which is derived from this same payload.
    const where: string[] = ["ma.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`ma.status = $${params.length}`);
    }
    if (filter.video_source) {
      params.push(filter.video_source);
      where.push(`ma.video_source = $${params.length}`);
    }
    if (typeof filter.level === "number") {
      params.push(filter.level);
      where.push(`ma.level_number = $${params.length}`);
    }
    if (typeof filter.attached === "boolean") {
      where.push(filter.attached ? `m.module_id IS NOT NULL` : `m.module_id IS NULL`);
    }
    if (filter.q) {
      params.push(`%${filter.q}%`);
      where.push(`(m.title ILIKE $${params.length}::text OR ma.caption ILIKE $${params.length}::text)`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT ma.media_asset_id, ma.kind, ma.status, ma.provider, ma.video_source,
              ma.external_url, ma.external_video_id, ma.caption, ma.level_number,
              ma.is_homepage, ma.duration_sec, ma.error_detail, ma.created_at,
              m.title AS attached_module_title, m.module_id AS attached_module_id,
              (ma.status = 'transcoding' AND ma.created_at < now() - interval '30 minutes') AS is_stuck,
              vp.views, vp.completion
         FROM media_assets ma
         LEFT JOIN modules m ON m.media_asset_id = ma.media_asset_id
         LEFT JOIN (
                SELECT media_asset_id,
                       COUNT(*)::int AS views,
                       ROUND(AVG(completed_pct))::int AS completion
                  FROM video_progress
                 GROUP BY media_asset_id
              ) vp ON vp.media_asset_id = ma.media_asset_id
        ${whereSql}
        ORDER BY ma.created_at DESC
        LIMIT 200`,
      params,
    );
    return {
      data: rows,
      total: rows.length,
      stuck: rows.filter((r) => r.is_stuck === true).length,
    };
  }

  // ---------------- Admin: external videos + library editing ----------------

  static readonly RegisterExternal = z
    .object({
      video_source: z.enum(["youtube", "vimeo", "direct", "private"]),
      url: z.string().url(),
      title: z.string().trim().min(1).optional(),
      caption: z.string().trim().optional(),
      level_number: z.number().int().positive().optional(),
    })
    .strict();

  /** Register an external (shareable) video. No transcode — status = 'ready'
   *  immediately. Parses the YouTube/Vimeo id server-side. */
  async registerExternal(
    adminId: string,
    input: z.infer<typeof VideoService.RegisterExternal>,
  ): Promise<unknown> {
    const { videoId } = parseExternalVideo(input.video_source, input.url);
    if ((input.video_source === "youtube" || input.video_source === "vimeo") && !videoId) {
      throw new ApiError("VALIDATION_FAILED", `Could not parse a ${input.video_source} video id from the URL`);
    }
    return tx(this.pool, async (c) => {
      const row = await one<{ media_asset_id: string }>(
        c,
        `INSERT INTO media_assets
            (cloudinary_id, kind, status, provider, video_source,
             external_url, external_video_id, caption, level_number, created_by)
         VALUES ('external', 'lesson_video', 'ready', $1::varchar, $2::text, $3, $4, $5, $6, $7)
         RETURNING media_asset_id`,
        [
          input.video_source,
          input.video_source,
          input.url,
          videoId,
          input.caption ?? null,
          input.level_number ?? null,
          adminId,
        ],
      );
      if (input.title) {
        // Title lives on the linked module; apply it if an attachment already
        // exists (single-attach model — no placement table this PR).
        await c.query(`UPDATE modules SET title = $1 WHERE media_asset_id = $2`, [input.title, row.media_asset_id]);
      }
      await audit(c, adminId, "media.external_register", "media_assets", row.media_asset_id, {
        video_source: input.video_source,
        external_video_id: videoId,
      });
      return this.getAssetRow(c, row.media_asset_id);
    });
  }

  /** Register a video that was uploaded to OUR OWN storage (VPS disk, not
   *  Cloudinary). The bytes already landed at `storageFilename` under
   *  MEDIA_STORAGE_DIR; we record a ready 'direct' asset whose external_url is the
   *  public (nginx-served) URL on our domain. Shareable + attachable like any
   *  other direct video; source_object_key holds the on-disk filename so archive
   *  can delete the file. */
  async registerUploaded(
    adminId: string,
    input: {
      storageFilename: string;
      publicUrl: string;
      title?: string | undefined;
      caption?: string | undefined;
      level_number?: number | undefined;
      duration_sec?: number | undefined;
    },
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ media_asset_id: string }>(
        c,
        `INSERT INTO media_assets
            (cloudinary_id, kind, status, provider, video_source,
             external_url, source_object_key, caption, level_number, duration_sec, created_by)
         VALUES ('local', 'lesson_video', 'ready', 'local', 'direct',
                 $1, $2, $3, $4, $5, $6)
         RETURNING media_asset_id`,
        [
          input.publicUrl,
          input.storageFilename,
          input.caption ?? null,
          input.level_number ?? null,
          input.duration_sec ?? null,
          adminId,
        ],
      );
      if (input.title) {
        await c.query(`UPDATE modules SET title = $1 WHERE media_asset_id = $2`, [input.title, row.media_asset_id]);
      }
      await audit(c, adminId, "media.upload_stored", "media_assets", row.media_asset_id, {
        storage: "local",
        filename: input.storageFilename,
      });
      return this.getAssetRow(c, row.media_asset_id);
    });
  }

  static readonly UpdateAsset = z
    .object({
      title: z.string().trim().min(1).optional(),
      caption: z.string().trim().optional(),
      level_number: z.number().int().positive().nullable().optional(),
      video_source: z.enum(["youtube", "vimeo", "direct", "private"]).optional(),
      url: z.string().url().optional(),
    })
    .strict();

  /** Edit library metadata: caption, level_number, and (for external) the source/url.
   *  Title is applied to the linked module when one is attached. */
  async updateAsset(
    adminId: string,
    id: string,
    input: z.infer<typeof VideoService.UpdateAsset>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<{ video_source: string }>(
        c,
        `SELECT video_source FROM media_assets WHERE media_asset_id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing) throw new ApiError("NOT_FOUND", "Media asset not found");

      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.caption !== undefined) push("caption", input.caption);
      if (input.level_number !== undefined) push("level_number", input.level_number);

      const newSource = input.video_source ?? existing.video_source;
      if (input.video_source !== undefined) {
        if (!EXTERNAL_SOURCES.has(input.video_source)) {
          throw new ApiError("VALIDATION_FAILED", "video_source must be external");
        }
        push("video_source", input.video_source);
      }
      if (input.url !== undefined) {
        if (!EXTERNAL_SOURCES.has(newSource)) {
          throw new ApiError("CONFLICT", "Cannot set an external url on a hosted asset");
        }
        const declared = newSource as "youtube" | "vimeo" | "direct" | "private";
        const { videoId } = parseExternalVideo(declared, input.url);
        if ((declared === "youtube" || declared === "vimeo") && !videoId) {
          throw new ApiError("VALIDATION_FAILED", `Could not parse a ${declared} video id from the URL`);
        }
        push("external_url", input.url);
        push("external_video_id", videoId);
      }

      if (sets.length > 0) {
        params.push(id);
        await c.query(`UPDATE media_assets SET ${sets.join(", ")} WHERE media_asset_id = $${params.length}`, params);
      }
      if (input.title !== undefined) {
        await c.query(`UPDATE modules SET title = $1 WHERE media_asset_id = $2`, [input.title, id]);
      }
      await audit(c, adminId, "media.update", "media_assets", id, { fields: Object.keys(input) });
      return this.getAssetRow(c, id);
    });
  }

  // ---------------- Admin: homepage welcome video ----------------

  /** Set THIS asset as the single homepage welcome video; unsets any other.
   *  The partial unique index guarantees the single-row invariant. */
  async setHomepage(adminId: string, id: string): Promise<{ is_homepage: true }> {
    return tx(this.pool, async (c) => {
      const exists = await maybeOne<{ media_asset_id: string }>(
        c,
        `SELECT media_asset_id FROM media_assets WHERE media_asset_id = $1`,
        [id],
      );
      if (!exists) throw new ApiError("NOT_FOUND", "Media asset not found");
      await c.query(`UPDATE media_assets SET is_homepage = false WHERE is_homepage = true AND media_asset_id <> $1`, [id]);
      await c.query(`UPDATE media_assets SET is_homepage = true WHERE media_asset_id = $1`, [id]);
      await audit(c, adminId, "media.homepage_set", "media_assets", id, {});
      return { is_homepage: true };
    });
  }

  /** Clear the homepage flag from this asset. */
  async clearHomepage(adminId: string, id: string): Promise<{ is_homepage: false }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`UPDATE media_assets SET is_homepage = false WHERE media_asset_id = $1`, [id]);
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Media asset not found");
      await audit(c, adminId, "media.homepage_clear", "media_assets", id, {});
      return { is_homepage: false };
    });
  }

  /** Member: the current homepage welcome video, or null. External sources
   *  return external_url + external_video_id; hosted return a signed delivery URL. */
  async welcomeVideo(): Promise<unknown | null> {
    const row = await maybeOne<{
      media_asset_id: string;
      video_source: string;
      external_url: string | null;
      external_video_id: string | null;
      caption: string | null;
      hls_master_key: string | null;
      source_object_key: string | null;
      duration_sec: number | null;
    }>(
      this.pool,
      `SELECT media_asset_id, video_source, external_url, external_video_id, caption,
              hls_master_key, source_object_key, duration_sec
         FROM media_assets WHERE is_homepage = true LIMIT 1`,
    );
    if (!row) return null;
    const base = {
      media_asset_id: row.media_asset_id,
      video_source: row.video_source,
      caption: row.caption,
      duration_sec: row.duration_sec,
    };
    // youtube / vimeo / direct / private all carry a shareable external_url
    // (best-effort gating only — these are inherently shareable links).
    if (EXTERNAL_SOURCES.has(row.video_source)) {
      return { ...base, external_url: row.external_url, external_video_id: row.external_video_id };
    }
    // cloudinary / hosted: signed, expiring delivery URL.
    const key = row.hls_master_key ?? row.source_object_key;
    if (!key) return { ...base, url: null };
    return { ...base, ...this.media.signedUrl(key, MANIFEST_TTL) };
  }

  private getAssetRow(c: Queryable, id: string): Promise<unknown> {
    return one(
      c,
      `SELECT media_asset_id, kind, status, provider, video_source, external_url,
              external_video_id, caption, level_number, is_homepage, ladder,
              duration_sec, hls_master_key, error_detail, created_at
         FROM media_assets WHERE media_asset_id = $1`,
      [id],
    );
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

  /** Archive an asset (soft-delete via deleted_at); refuse if a PUBLISHED module
   *  still references it. Returns the on-disk filename for self-hosted assets so
   *  the route can delete the file from our storage. */
  async archiveAsset(adminId: string, id: string): Promise<{ archived: boolean; local_file: string | null }> {
    return tx(this.pool, async (c) => {
      const refs = await one<{ n: number }>(
        c,
        `SELECT COUNT(*)::int AS n FROM modules WHERE media_asset_id = $1 AND status = 'published'`,
        [id],
      );
      if (refs.n > 0) {
        throw new ApiError("CONFLICT", "Asset is referenced by a published module; unpublish first");
      }
      const row = await maybeOne<{ provider: string | null; source_object_key: string | null }>(
        c,
        `UPDATE media_assets
            SET deleted_at = now(), is_homepage = false
          WHERE media_asset_id = $1 AND deleted_at IS NULL
          RETURNING provider, source_object_key`,
        [id],
      );
      if (!row) throw new ApiError("NOT_FOUND", "Media asset not found");
      await audit(c, adminId, "media.archived", "media_assets", id, {});
      return { archived: true, local_file: row.provider === "local" ? row.source_object_key : null };
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
