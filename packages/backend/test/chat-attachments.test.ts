// Chat attachment object-key derivation (mobile Chat make). Pure logic — the
// real signed upload rides MediaService (covered by media.test) and Cloudinary.
import { describe, it, expect } from "vitest";
import { attachmentObjectKey, extForContentType } from "../src/modules/chat/attachments.js";

describe("chat attachment keys", () => {
  it("maps common content types to extensions", () => {
    expect(extForContentType("image/jpeg")).toBe(".jpg");
    expect(extForContentType("image/png")).toBe(".png");
    expect(extForContentType("audio/m4a")).toBe(".m4a");
    expect(extForContentType("video/mp4")).toBe(".mp4");
    expect(extForContentType("image/png; charset=binary")).toBe(".png"); // strips params
    expect(extForContentType("application/x-weird")).toBe(""); // unknown → no ext
  });

  it("namespaces the key under the author with a unique id + extension", () => {
    const k = attachmentObjectKey("user-123", "image/jpeg");
    expect(k.startsWith("chat/user-123/")).toBe(true);
    expect(k.endsWith(".jpg")).toBe(true);
    expect(attachmentObjectKey("user-123", "image/jpeg")).not.toBe(k); // unique each call
  });
});
