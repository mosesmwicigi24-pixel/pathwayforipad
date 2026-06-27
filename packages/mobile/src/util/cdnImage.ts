// Responsive image delivery (free, no native dep). Cloudinary can resize + re-encode
// on the fly via URL params, so instead of downloading a 2–4 MB original for a small
// card we ask for a device-sized, modern-format (WebP/AVIF) copy off their CDN. This
// is the single biggest mobile-data + perceived-speed win for every photo in the app.
//
// `f_auto` = best format for the device, `q_auto` = perceptually-tuned quality,
// `c_limit,w_…` = never deliver (or upscale past) more pixels than we render. Non-
// Cloudinary URLs (e.g. self-hosted /media, local files) pass through untouched, so
// this is always safe to wrap around any image source.
import { PixelRatio } from "react-native";

const UPLOAD = "/image/upload/";
// A transform segment already present? (first path segment after /upload/ uses a
// Cloudinary param like f_/q_/w_/c_/dpr_…). If so we leave the URL alone.
const HAS_TRANSFORM = /(^|,)(f_|q_|w_|h_|c_|dpr_|e_|g_|ar_)/;

/**
 * Rewrite a Cloudinary delivery URL to a device-sized, auto-format, auto-quality
 * variant. Pass the rendered width (and optional height) in DIPs — we multiply by
 * the screen's pixel density so retina screens stay crisp. Omitting width still
 * applies `f_auto,q_auto` (a big saving on its own). Anything that isn't a
 * Cloudinary image URL is returned verbatim.
 */
export function cdnImage(uri?: string | null, opts: { width?: number; height?: number } = {}): string | undefined {
  if (!uri) return uri ?? undefined;
  const at = uri.indexOf(UPLOAD);
  if (at === -1 || !uri.includes("cloudinary.com")) return uri; // not transformable
  const after = uri.slice(at + UPLOAD.length);
  const firstSeg = after.split("/")[0] ?? "";
  if (HAS_TRANSFORM.test(firstSeg)) return uri; // already transformed

  const px = (n: number): number => Math.round(n * PixelRatio.get());
  const parts = ["f_auto", "q_auto"];
  if (opts.width) parts.push("c_limit", `w_${px(opts.width)}`);
  if (opts.height) parts.push(`h_${px(opts.height)}`);
  return uri.slice(0, at + UPLOAD.length) + parts.join(",") + "/" + after;
}
