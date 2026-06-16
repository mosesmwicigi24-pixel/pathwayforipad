// Media (spec §4.5, §5.7). Brokers short-lived signed delivery URLs so raw asset
// references never leak and links expire. CLOUDINARY_URL holds the credentials
// (cloudinary://api_key:api_secret@cloud_name). The HMAC token here stands in for
// Cloudinary's exact signed-URL scheme — same guarantee (tamper-evident, expiring).
import { createHmac, createHash } from "node:crypto";
import { ApiError } from "../../http/errors.js";

interface CloudinaryConfig {
  cloud: string;
  apiKey: string;
  apiSecret: string;
}

function parseCloudinaryUrl(url: string | undefined): CloudinaryConfig | null {
  if (!url) return null;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m) return null;
  const apiKey = m[1];
  const apiSecret = m[2];
  const cloud = m[3];
  if (!apiKey || !apiSecret || !cloud) return null;
  return { cloud, apiKey, apiSecret };
}

/** Cloudinary signed-upload params (real Cloudinary REST API, §4.5). */
export interface CloudinaryUploadSignature {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
  upload_url: string;
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

  /**
   * Real Cloudinary signed-upload params (§4.5). The client POSTs the file
   * directly (multipart) to `upload_url` with these fields — bytes never touch
   * our server. Signature = sha1 of the sorted to-sign params + api_secret;
   * `resource_type=auto` lives in the URL path (not signed). Cloudinary returns
   * `secure_url` + `public_id`, which the caller stores on the message.
   */
  signUpload(opts: { folder?: string } = {}): CloudinaryUploadSignature {
    if (!this.cfg) throw new ApiError("UPSTREAM_UNAVAILABLE", "Media uploads are not configured");
    const folder = opts.folder ?? "nuru";
    const timestamp = Math.floor(this.now() / 1000);
    const toSign = `folder=${folder}&timestamp=${timestamp}`; // keys sorted: folder < timestamp
    const signature = createHash("sha1").update(toSign + this.cfg.apiSecret).digest("hex");
    return {
      cloud_name: this.cfg.cloud,
      api_key: this.cfg.apiKey,
      timestamp,
      folder,
      signature,
      upload_url: `https://api.cloudinary.com/v1_1/${this.cfg.cloud}/auto/upload`,
    };
  }

  /** A signed, expiring direct-upload (PUT) URL — the server never proxies bytes (§4.5). */
  signedUploadUrl(objectKey: string, ttlSeconds = 900): { url: string; expires_at: string } {
    if (!this.cfg) throw new ApiError("UPSTREAM_UNAVAILABLE", "Media delivery is not configured");
    if (!objectKey) throw new ApiError("VALIDATION_FAILED", "objectKey is required");
    const expires = Math.floor(this.now() / 1000) + ttlSeconds;
    const sig = createHmac("sha256", this.cfg.apiSecret)
      .update(`PUT:${objectKey}:${expires}`)
      .digest("hex")
      .slice(0, 32);
    return {
      url: `https://upload.cloudinary.com/${this.cfg.cloud}/${objectKey}?expires=${expires}&sig=${sig}&method=put`,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  }
}
