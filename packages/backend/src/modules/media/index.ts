// Module: media (spec §1.5, §4.5)
// Owns: signed, expiring delivery URLs for lesson videos / products / certificate
// PDFs; raw asset references never leave the server.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody } from "../../http/http.js";
import { MediaService } from "./service.js";

export const mediaRouter: Router = Router();

export function registerMedia(ctx: AppContext): Router {
  const svc = new MediaService(ctx.env.CLOUDINARY_URL);
  const auth = authenticate(ctx.env);
  const r = mediaRouter;

  // Broker a signed URL for an object key the caller already holds a reference to
  // (e.g. a module's video, or a certificate download link).
  r.get(
    "/media/url",
    auth,
    handler(async (req, res) => {
      const { key } = parseBody(z.object({ key: z.string().min(1) }), req.query);
      res.json(svc.signedUrl(key));
    }),
  );

  return r;
}
