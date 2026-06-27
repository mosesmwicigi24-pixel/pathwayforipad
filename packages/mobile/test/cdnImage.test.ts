// cdnImage — Cloudinary responsive-delivery URL rewriting (pure function).
import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => ({ PixelRatio: { get: () => 2 } }));

import { cdnImage } from "../src/util/cdnImage";

const CLD = "https://res.cloudinary.com/nuru/image/upload/v1700/pic.jpg";

describe("cdnImage", () => {
  it("injects f_auto,q_auto + a device-sized width (×dpr) into a Cloudinary URL", () => {
    expect(cdnImage(CLD, { width: 100 })).toBe(
      "https://res.cloudinary.com/nuru/image/upload/f_auto,q_auto,c_limit,w_200/v1700/pic.jpg",
    );
  });

  it("still applies format + quality with no size hint", () => {
    expect(cdnImage(CLD)).toBe("https://res.cloudinary.com/nuru/image/upload/f_auto,q_auto/v1700/pic.jpg");
  });

  it("leaves a self-hosted /media URL untouched", () => {
    const m = "https://pathway.nuruplace.org/media/abc.jpg";
    expect(cdnImage(m, { width: 100 })).toBe(m);
  });

  it("never double-transforms an already-optimized URL", () => {
    const t = "https://res.cloudinary.com/nuru/image/upload/f_auto,q_auto/v1700/pic.jpg";
    expect(cdnImage(t, { width: 100 })).toBe(t);
  });

  it("passes through null / undefined", () => {
    expect(cdnImage(undefined)).toBeUndefined();
    expect(cdnImage(null)).toBeUndefined();
  });
});
