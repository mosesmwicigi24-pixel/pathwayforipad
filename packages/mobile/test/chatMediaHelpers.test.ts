// Chat native-media helpers — pure presentation/wire mapping for voice notes and
// file attachments. The React tree isn't exercised (the suite stays render-free
// like the other screen tests); we lock the mm:ss timer, byte formatting, the
// received-bubble labels, and the attachment_meta shapes sent to the chat API.
import { describe, it, expect } from "vitest";
import {
  formatMillis,
  durationSecs,
  formatBytes,
  voiceLabel,
  fileLabel,
  voiceFileName,
  voiceAttachmentMeta,
  fileAttachmentMeta,
} from "../src/screens/chatMediaHelpers";

describe("Chat media: recorder timer", () => {
  it("formats milliseconds as mm:ss with zero-padded seconds", () => {
    expect(formatMillis(0)).toBe("0:00");
    expect(formatMillis(5_000)).toBe("0:05");
    expect(formatMillis(65_000)).toBe("1:05");
    expect(formatMillis(600_000)).toBe("10:00");
  });
  it("never goes negative", () => {
    expect(formatMillis(-100)).toBe("0:00");
  });
  it("rounds a ms duration to whole seconds", () => {
    expect(durationSecs(12_400)).toBe(12);
    expect(durationSecs(12_600)).toBe(13);
    expect(durationSecs(-5)).toBe(0);
  });
});

describe("Chat media: byte formatting", () => {
  it("renders bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
  it("returns empty for unknown/zero sizes", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(0)).toBe("");
  });
});

describe("Chat media: bubble labels", () => {
  it("appends a duration to the voice label when known", () => {
    expect(voiceLabel(12)).toBe("Voice message · 0:12");
    expect(voiceLabel(null)).toBe("Voice message");
    expect(voiceLabel(0)).toBe("Voice message");
  });
  it("falls back to a generic file name when none given", () => {
    expect(fileLabel("report.pdf")).toBe("report.pdf");
    expect(fileLabel("  ")).toBe("Attachment");
    expect(fileLabel(null)).toBe("Attachment");
  });
});

describe("Chat media: send payload shapes", () => {
  it("derives a timestamped m4a voice filename", () => {
    expect(voiceFileName(1700000000000)).toBe("voice-1700000000000.m4a");
  });
  it("builds voice attachment_meta with whole-second duration", () => {
    const meta = voiceAttachmentMeta({ public_id: "vn1", bytes: 8000 }, "voice-1.m4a", 12_600);
    expect(meta).toEqual({ public_id: "vn1", bytes: 8000, name: "voice-1.m4a", duration: 13 });
  });
  it("builds file attachment_meta, preferring the picker size and falling back to uploaded bytes", () => {
    expect(fileAttachmentMeta({ public_id: "f1", bytes: 5000 }, "doc.pdf", 4096)).toEqual({
      public_id: "f1",
      bytes: 5000,
      name: "doc.pdf",
      size: 4096,
    });
    expect(fileAttachmentMeta({ public_id: "f2", bytes: 5000 }, "doc.pdf", null)).toEqual({
      public_id: "f2",
      bytes: 5000,
      name: "doc.pdf",
      size: 5000,
    });
  });
});
