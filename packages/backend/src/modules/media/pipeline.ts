// Video transcode pipeline (Features v2 §V.0/§V.3). Provider-abstracted so the
// platform can move off Cloudinary without API changes: same manifest contract
// either way. The rendition ladder is hard-capped at 720p/30fps (PRD §7.3 / §D.1)
// — the execution doc's 1080p tier is intentionally dropped.
import type { Env } from "../../config/env.js";

export interface LadderRung {
  height: number;
  kbps: number;
}

// 720p cap (§D.1). Order high→low; players start mid and adapt.
export const RENDITION_LADDER: LadderRung[] = [
  { height: 720, kbps: 2200 },
  { height: 480, kbps: 1100 },
  { height: 360, kbps: 600 },
];

export interface TranscodeInput {
  mediaAssetId: string;
  sourceObjectKey: string;
  contentHash: string;
}

export interface TranscodeResult {
  hlsMasterKey: string;
  ladder: LadderRung[];
}

export interface VideoPipelineProvider {
  readonly name: "cloudinary" | "hls";
  /** Produce the HLS master + rendition ladder for a source upload. Idempotent. */
  transcode(input: TranscodeInput): Promise<TranscodeResult>;
}

/** Default adapter — Cloudinary managed ABR (matches v1 spec). */
export class CloudinaryProvider implements VideoPipelineProvider {
  readonly name = "cloudinary" as const;
  transcode(input: TranscodeInput): Promise<TranscodeResult> {
    // Real impl triggers eager ABR derivations and resolves the delivered master.
    return Promise.resolve({
      hlsMasterKey: `${input.sourceObjectKey.replace(/\.[^.]+$/, "")}/master.m3u8`,
      ladder: RENDITION_LADDER,
    });
  }
}

/** Self-managed adapter — FFmpeg → object store → CDN (execution doc flow, minus 1080p). */
export class HlsFfmpegProvider implements VideoPipelineProvider {
  readonly name = "hls" as const;
  constructor(private readonly bucket: string | undefined) {}
  transcode(input: TranscodeInput): Promise<TranscodeResult> {
    // Real impl runs ffmpeg on the CPU node group, writing v{0..2}/*.ts + master.m3u8.
    const base = `${this.bucket ?? "media"}/${input.mediaAssetId}`;
    return Promise.resolve({
      hlsMasterKey: `${base}/master.m3u8`,
      ladder: RENDITION_LADDER,
    });
  }
}

export function buildVideoPipeline(env: Env): VideoPipelineProvider {
  return env.VIDEO_PROVIDER === "hls"
    ? new HlsFfmpegProvider(env.STORAGE_BUCKET_MEDIA)
    : new CloudinaryProvider();
}
