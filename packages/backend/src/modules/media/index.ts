// Module: media (spec §1.5, §4.5; Features v2 §V)
// Owns: signed, expiring delivery URLs; the video transcode pipeline (upload
// sessions, gated HLS manifests, cross-device resume). Raw bytes never proxied.
import { mkdirSync, unlink } from "node:fs";
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
        z.object({ folder: z.enum(["events", "announcements", "videos"]).default("events") }),
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
      // Self-hosted file: remove the bytes from our disk (best-effort).
      if (result.local_file) unlink(join(storageDir, result.local_file), () => undefined);
      res.json({ archived: result.archived });
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
    handler(async (_req, res) => {
      res.json(await video.welcomeVideo());
    }),
  );

  return r;
}
