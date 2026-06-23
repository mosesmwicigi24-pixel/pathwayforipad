// Module: media (spec §1.5, §4.5; Features v2 §V)
// Owns: signed, expiring delivery URLs; the video transcode pipeline (upload
// sessions, gated HLS manifests, cross-device resume). Raw bytes never proxied.
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync, unlink } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ApiError } from "../../http/errors.js";
import { MediaService } from "./service.js";
import { VideoService } from "./video.js";
import { buildVideoPipeline } from "./pipeline.js";

export const mediaRouter: Router = Router();

export function registerMedia(ctx: AppContext): Router {
  const media = new MediaService(ctx.env.CLOUDINARY_URL);
  const video = new VideoService(ctx.db.primary, media, buildVideoPipeline(ctx.env));
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica); // RBAC: videos module (Video Library, §5.4)
  const r = mediaRouter;

  // --- Self-hosted video uploads: bytes stream straight to OUR disk (not
  // Cloudinary). multer writes the file to MEDIA_STORAGE_DIR; we then record a
  // 'direct' asset whose external_url is the public nginx-served URL. ---
  const storageDir = ctx.env.MEDIA_STORAGE_DIR ?? "/tmp/nuru-media";
  try { mkdirSync(storageDir, { recursive: true }); } catch { /* best-effort; route fails loudly if unwritable */ }
  const publicBase = (ctx.env.MEDIA_PUBLIC_BASE_URL ?? "http://localhost:8080/media").replace(/\/+$/, "");
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageDir),
      filename: (_req, file, cb) => {
        const ext = (extname(file.originalname) || ".mp4").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: ctx.env.MEDIA_MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith("video/")) cb(null, true);
      else cb(new ApiError("VALIDATION_FAILED", "Only video files can be uploaded"));
    },
  });
  // Run multer, mapping its errors (e.g. size cap) to our ApiError envelope.
  const uploadVideo = (req: Request, res: Response, next: NextFunction): void =>
    upload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(
          new ApiError(
            "VALIDATION_FAILED",
            err.code === "LIMIT_FILE_SIZE" ? "Video exceeds the maximum upload size" : err.message,
          ),
        );
      }
      return next(err);
    });

  // Thumbnail (poster) images also live on our own disk (served via /media). 10 MB
  // cap, images only — used for uploaded posters and frames captured from a video.
  const THUMB_MAX = 10 * 1024 * 1024;
  const uploadThumb = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageDir),
      filename: (_req, file, cb) => {
        const ext = (extname(file.originalname) || ".jpg").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
        cb(null, `thumb_${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: THUMB_MAX, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith("image/")) cb(null, true);
      else cb(new ApiError("VALIDATION_FAILED", "Thumbnail must be an image"));
    },
  });
  const uploadThumbnail = (req: Request, res: Response, next: NextFunction): void =>
    uploadThumb.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(new ApiError("VALIDATION_FAILED", err.code === "LIMIT_FILE_SIZE" ? "Thumbnail exceeds 10 MB" : err.message));
      }
      return next(err);
    });
  // Map a stored thumbnail URL back to its on-disk filename (for cleanup).
  const thumbFile = (url: string | null): string | null =>
    url && url.startsWith(publicBase + "/") ? url.slice(publicBase.length + 1) : null;

  // Member profile photo — any member uploads their own (5 MB, images only),
  // bytes land on our disk (served via /media) and we store the URL on the user.
  const AVATAR_MAX = 5 * 1024 * 1024;
  const uploadAvatar = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageDir),
      filename: (_req, file, cb) => {
        const ext = (extname(file.originalname) || ".jpg").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
        cb(null, `avatar_${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: AVATAR_MAX, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith("image/")) cb(null, true);
      else cb(new ApiError("VALIDATION_FAILED", "Profile photo must be an image"));
    },
  });
  const uploadAvatarMw = (req: Request, res: Response, next: NextFunction): void =>
    uploadAvatar.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(new ApiError("VALIDATION_FAILED", err.code === "LIMIT_FILE_SIZE" ? "Photo exceeds 5 MB" : err.message));
      }
      return next(err);
    });

  r.post("/me/avatar", auth, uploadAvatarMw, handler(async (req, res) => {
    const file = req.file;
    if (!file) throw new ApiError("VALIDATION_FAILED", "No image was uploaded (field 'file')");
    const url = `${publicBase}/${file.filename}`;
    await ctx.db.primary.query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE user_id = $1`, [
      requirePrincipal(req).userId,
      url,
    ]);
    res.status(201).json({ avatar_url: url });
  }));

  // Broker a signed URL for an object key the caller already holds a reference to.
  r.get(
    "/media/url",
    auth,
    handler(async (req, res) => {
      const { key } = parseBody(z.object({ key: z.string().min(1) }), req.query);
      res.json(media.signedUrl(key));
    }),
  );

  // Member: gated, expiring HLS master manifest (§V.2). 409 GATE_LOCKED / 404 if not ready.
  r.get(
    "/media/:id/manifest",
    auth,
    handler(async (req, res) => {
      res.json(await video.manifest(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Broker Cloudinary signed-upload params for an admin image (event/announcement
  // cover or gallery). Client POSTs bytes directly to Cloudinary (§4.5). Instructor+
  // (events are Instructor-creatable; announcements are Admin-gated at their route).
  r.post(
    "/admin/media/images/sign",
    auth, requireRole("Instructor"),
    handler(async (req, res) => {
      const { folder } = parseBody(
        z.object({ folder: z.enum(["events", "announcements", "videos", "disciplers"]).default("events") }),
        req.body ?? {},
      );
      res.status(201).json(media.signUpload({ folder: `nuru/${folder}` }));
    }),
  );

  // Admin: direct-to-storage upload sessions + transcode lifecycle.
  r.post(
    "/admin/media/uploads",
    auth, perm("videos", "create"),
    handler(async (req, res) => {
      const input = parseBody(VideoService.CreateUpload, req.body ?? {});
      res.status(201).json(await video.createUploadSession(requirePrincipal(req).userId, input));
    }),
  );

  r.post(
    "/admin/media/uploads/:id/complete",
    auth, perm("videos", "create"),
    handler(async (req, res) => {
      const input = parseBody(VideoService.CompleteUpload, req.body ?? {});
      res.json(await video.completeUpload(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );

  r.get(
    "/admin/media",
    auth, perm("videos", "view"),
    handler(async (req, res) => {
      const filter = parseBody(VideoService.ListFilter, req.query);
      res.json(await video.listAssets(filter));
    }),
  );

  // Upload a video straight to OUR storage (VPS disk). The file streams to disk
  // via multer; we register it as a ready 'direct' asset with a public URL.
  r.post(
    "/admin/media/videos/upload",
    auth, perm("videos", "create"),
    uploadVideo,
    handler(async (req, res) => {
      const file = req.file;
      if (!file) throw new ApiError("VALIDATION_FAILED", "No video file was uploaded (field 'file')");
      const body = parseBody(
        z
          .object({
            title: z.string().trim().min(1).optional(),
            caption: z.string().trim().optional(),
            level_number: z.coerce.number().int().positive().optional(),
          })
          .partial(),
        req.body ?? {},
      );
      res.status(201).json(
        await video.registerUploaded(requirePrincipal(req).userId, {
          storageFilename: file.filename,
          publicUrl: `${publicBase}/${file.filename}`,
          ...body,
        }),
      );
    }),
  );

  // --- Chunked PARALLEL upload (much faster over high-latency links). The client
  // splits the file and PUTs many chunks concurrently; a single TCP stream can't
  // fill the pipe to a distant VPS, so N streams ≈ N× throughput. Each chunk is
  // raw octet-stream bytes streamed to disk; finalize concatenates them in order. ---
  const chunksRoot = join(storageDir, ".chunks");
  const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv", ".ogg", ".ogv", ".m4p", ".3gp"]);
  const ChunkQuery = z.object({ upload_id: z.string().uuid(), index: z.coerce.number().int().min(0).max(200_000) });

  r.put(
    "/admin/media/videos/chunk",
    auth, perm("videos", "create"),
    (req: Request, res: Response, next: NextFunction): void => {
      const parsed = ChunkQuery.safeParse(req.query);
      if (!parsed.success) { next(new ApiError("VALIDATION_FAILED", "Bad chunk params")); return; }
      const dir = join(chunksRoot, parsed.data.upload_id);
      try { mkdirSync(dir, { recursive: true }); } catch { /* surfaced via the write stream error */ }
      const ws = createWriteStream(join(dir, String(parsed.data.index)));
      ws.on("finish", () => res.json({ ok: true, index: parsed.data.index }));
      ws.on("error", next);
      req.on("error", next);
      req.pipe(ws);
    },
  );

  r.post(
    "/admin/media/videos/finalize",
    auth, perm("videos", "create"),
    handler(async (req, res) => {
      const body = parseBody(
        z.object({
          upload_id: z.string().uuid(),
          total_chunks: z.coerce.number().int().min(1).max(200_000),
          filename: z.string().min(1).max(300).optional(),
          title: z.string().trim().min(1).optional(),
          caption: z.string().trim().optional(),
          level_number: z.coerce.number().int().positive().optional(),
        }),
        req.body ?? {},
      );
      const dir = join(chunksRoot, body.upload_id);
      // Every chunk must be present; total size within the cap.
      let total = 0;
      for (let i = 0; i < body.total_chunks; i++) {
        const cp = join(dir, String(i));
        if (!existsSync(cp)) throw new ApiError("VALIDATION_FAILED", `Missing chunk ${i} — please retry the upload`);
        total += statSync(cp).size;
      }
      const cap = ctx.env.MEDIA_MAX_UPLOAD_BYTES ?? 524_288_000;
      if (total > cap) {
        rmSync(dir, { recursive: true, force: true });
        throw new ApiError("VALIDATION_FAILED", "Video exceeds the maximum upload size");
      }
      const rawExt = extname(body.filename ?? "").toLowerCase().replace(/[^.a-z0-9]/g, "");
      const ext = VIDEO_EXTS.has(rawExt) ? rawExt : ".mp4";
      const finalName = `${randomUUID()}${ext}`;
      const finalPath = join(storageDir, finalName);
      const out = createWriteStream(finalPath);
      try {
        for (let i = 0; i < body.total_chunks; i++) {
          const cp = join(dir, String(i));
          await new Promise<void>((resolve, reject) => {
            const rs = createReadStream(cp);
            rs.on("error", reject);
            rs.on("end", () => resolve());
            rs.pipe(out, { end: false });
          });
        }
        await new Promise<void>((resolve, reject) => { out.end(() => resolve()); out.on("error", reject); });
      } catch (e) {
        out.destroy();
        unlink(finalPath, () => undefined);
        throw e;
      }
      rmSync(dir, { recursive: true, force: true });
      res.status(201).json(
        await video.registerUploaded(requirePrincipal(req).userId, {
          storageFilename: finalName,
          publicUrl: `${publicBase}/${finalName}`,
          title: body.title,
          caption: body.caption,
          level_number: body.level_number,
        }),
      );
    }),
  );

  // Register an external (YouTube/Vimeo/direct/private) video — no transcode.
  r.post(
    "/admin/media/external",
    auth, perm("videos", "create"),
    handler(async (req, res) => {
      const input = parseBody(VideoService.RegisterExternal, req.body ?? {});
      res.status(201).json(await video.registerExternal(requirePrincipal(req).userId, input));
    }),
  );

  r.get(
    "/admin/media/:id",
    auth, perm("videos", "view"),
    handler(async (req, res) => {
      res.json(await video.getAsset(req.params.id ?? ""));
    }),
  );

  // Edit library metadata (caption, level, title; external source/url).
  r.patch(
    "/admin/media/:id",
    auth, perm("videos", "update"),
    handler(async (req, res) => {
      const input = parseBody(VideoService.UpdateAsset, req.body ?? {});
      res.json(await video.updateAsset(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );

  r.delete(
    "/admin/media/:id",
    auth, perm("videos", "delete"),
    handler(async (req, res) => {
      const result = await video.archiveAsset(requirePrincipal(req).userId, req.params.id ?? "");
      // Self-hosted files: remove the video + thumbnail bytes from our disk (best-effort).
      if (result.local_file) unlink(join(storageDir, result.local_file), () => undefined);
      const tf = thumbFile(result.thumbnail_url);
      if (tf) unlink(join(storageDir, tf), () => undefined);
      res.json({ archived: result.archived });
    }),
  );

  // Per-video thumbnail (poster). Upload an image OR a frame captured client-side
  // from the video; bytes land on our disk and we record the public URL.
  r.post(
    "/admin/media/:id/thumbnail",
    auth, perm("videos", "update"),
    uploadThumbnail,
    handler(async (req, res) => {
      const file = req.file;
      if (!file) throw new ApiError("VALIDATION_FAILED", "No thumbnail image was uploaded (field 'file')");
      res.json(await video.setThumbnail(requirePrincipal(req).userId, req.params.id ?? "", `${publicBase}/${file.filename}`));
    }),
  );
  r.delete(
    "/admin/media/:id/thumbnail",
    auth, perm("videos", "update"),
    handler(async (req, res) => {
      res.json(await video.setThumbnail(requirePrincipal(req).userId, req.params.id ?? "", null));
    }),
  );

  // Homepage welcome video (single-row invariant): set / clear.
  r.post(
    "/admin/media/:id/homepage",
    auth, perm("videos", "update"),
    handler(async (req, res) => {
      res.json(await video.setHomepage(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  r.delete(
    "/admin/media/:id/homepage",
    auth, perm("videos", "update"),
    handler(async (req, res) => {
      res.json(await video.clearHomepage(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Member: the current homepage welcome video (or null).
  r.get(
    "/home/welcome-video",
    auth,
    handler(async (req, res) => {
      res.json(await video.welcomeVideo(requirePrincipal(req).userId));
    }),
  );

  // Member: toggle a reaction (emoji; ❤️ = Like) on a media asset.
  r.post(
    "/media/:id/reactions",
    auth,
    handler(async (req, res) => {
      const { emoji } = parseBody(z.object({ emoji: z.string().min(1).max(16) }), req.body ?? {});
      res.json(await video.toggleReaction(requirePrincipal(req).userId, req.params.id ?? "", emoji));
    }),
  );

  return r;
}
