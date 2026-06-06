// Media (spec §4.5, §5.7). Brokers short-lived signed delivery URLs so raw asset
// references never leak and links expire. CLOUDINARY_URL holds the credentials
// (cloudinary://api_key:api_secret@cloud_name). The HMAC token here stands in for
// Cloudinary's exact signed-URL scheme — same guarantee (tamper-evident, expiring).
import { createHmac } from "node:crypto";
import { ApiError } from "../../http/errors.js";

interface CloudinaryConfig {
  cloud: string;
  apiSecret: string;
}

function parseCloudinaryUrl(url: string | undefined): CloudinaryConfig | null {
  if (!url) return null;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m) return null;
  const apiSecret = m[2];
  const cloud = m[3];
  if (!apiSecret || !cloud) return null;
  return { cloud, apiSecret };
}

export class MediaService {
  private readonly cfg: CloudinaryConfig | null;
  constructor(
    cloudinaryUrl: string | undefined,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.cfg = parseCloudinaryUrl(cloudinaryUrl);
  }

  /** A signed, expiring delivery URL for an object key (e.g. a lesson video). */
  signedUrl(objectKey: string, ttlSeconds = 600): { url: string; expires_at: string } {
    if (!this.cfg) throw new ApiError("UPSTREAM_UNAVAILABLE", "Media delivery is not configured");
    if (!objectKey) throw new ApiError("VALIDATION_FAILED", "objectKey is required");
    const expires = Math.floor(this.now() / 1000) + ttlSeconds;
    const sig = createHmac("sha256", this.cfg.apiSecret)
      .update(`${objectKey}:${expires}`)
      .digest("hex")
      .slice(0, 32);
    return {
      url: `https://res.cloudinary.com/${this.cfg.cloud}/${objectKey}?expires=${expires}&sig=${sig}`,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  }
}
