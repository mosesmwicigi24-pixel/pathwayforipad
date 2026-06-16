// Media — signed, expiring delivery URLs (§4.5).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MediaService } from "../src/modules/media/service.js";

const URL = "cloudinary://key123:secret456@nuru-cloud";
const FIXED = Date.parse("2026-06-06T00:00:00Z");

describe("media signed URLs (§4.5)", () => {
  it("produces a signed, expiring URL for an object key", () => {
    const svc = new MediaService(URL, () => FIXED);
    const { url, expires_at } = svc.signedUrl("lessons/intro.mp4", 600);
    expect(url).toContain("https://res.cloudinary.com/nuru-cloud/lessons/intro.mp4");
    expect(url).toMatch(/expires=\d+/);
    expect(url).toMatch(/sig=[0-9a-f]{32}/);
    expect(new Date(expires_at).getTime()).toBe(FIXED + 600_000);
  });

  it("is deterministic for the same inputs", () => {
    const a = new MediaService(URL, () => FIXED).signedUrl("x.mp4", 600);
    const b = new MediaService(URL, () => FIXED).signedUrl("x.mp4", 600);
    expect(a.url).toBe(b.url);
  });

  it("throws when media is not configured", () => {
    expect(() => new MediaService(undefined).signedUrl("x.mp4")).toThrow();
  });
});

describe("Cloudinary signed upload (§4.5)", () => {
  it("signs upload params with Cloudinary's exact scheme (sha1 of sorted params + secret)", () => {
    const svc = new MediaService(URL, () => FIXED);
    const sig = svc.signUpload({ folder: "nuru/chat/u1" });
    const ts = Math.floor(FIXED / 1000);
    const expected = createHash("sha1").update(`folder=nuru/chat/u1&timestamp=${ts}secret456`).digest("hex");
    expect(sig.cloud_name).toBe("nuru-cloud");
    expect(sig.api_key).toBe("key123");
    expect(sig.timestamp).toBe(ts);
    expect(sig.folder).toBe("nuru/chat/u1");
    expect(sig.signature).toBe(expected);
    expect(sig.upload_url).toBe("https://api.cloudinary.com/v1_1/nuru-cloud/auto/upload");
  });

  it("throws when media is not configured", () => {
    expect(() => new MediaService(undefined).signUpload({ folder: "x" })).toThrow();
  });
});
