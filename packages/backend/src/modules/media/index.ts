// Module: media (spec §1.5, §4.5; Features v2 §V)
// Owns: signed, expiring delivery URLs; the video transcode pipeline (upload
// sessions, gated HLS manifests, cross-device resume). Raw bytes never proxied.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { MediaService } from "./service.js";
import { VideoService } from "./video.js";
import { buildVideoPipeline } from "./pipeline.js";

export const mediaRouter: Router = Router();

export function registerMedia(ctx: AppContext): Router {
  const media = new MediaService(ctx.env.CLOUDINARY_URL);
  const video = new VideoService(ctx.db.primary, media, buildVideoPipeline(ctx.env));
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const r = mediaRouter;

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

  // Admin: direct-to-storage upload sessions + transcode lifecycle.
  r.post(
    "/admin/media/uploads",
    ...adminOnly,
    handler(async (req, res) => {
      const input = parseBody(VideoService.CreateUpload, req.body ?? {});
      res.status(201).json(await video.createUploadSession(requirePrincipal(req).userId, input));
    }),
  );

  r.post(
    "/admin/media/uploads/:id/complete",
    ...adminOnly,
    handler(async (req, res) => {
      const input = parseBody(VideoService.CompleteUpload, req.body ?? {});
      res.json(await video.completeUpload(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );

  r.get(
    "/admin/media",
    ...adminOnly,
    handler(async (_req, res) => {
      res.json(await video.listAssets());
    }),
  );

  r.get(
    "/admin/media/:id",
    ...adminOnly,
    handler(async (req, res) => {
      res.json(await video.getAsset(req.params.id ?? ""));
    }),
  );

  r.delete(
    "/admin/media/:id",
    ...adminOnly,
    handler(async (req, res) => {
      res.json(await video.archiveAsset(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  return r;
}
