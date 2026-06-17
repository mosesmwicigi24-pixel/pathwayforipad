// Chat thread — pure, render-free helpers for the native-media composer (voice
// notes + file attachments). No React Native imports, so they unit-test in the
// node-based vitest suite (mirrors givingHelpers.ts / reflectionStates.ts). These
// lock the wire shape we send to POST /chat/conversations/:id/messages for the
// "voice" and "file" msg_types, plus the small format helpers the UI renders.

/** mm:ss from a millisecond position (recorder reports currentPosition in ms). */
export function formatMillis(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Whole seconds (rounded) from a millisecond duration — stored in attachment_meta.duration. */
export function durationSecs(ms: number): number {
  return Math.max(0, Math.round(ms / 1000));
}

/** Human file size for the received-file chip ("12 KB", "3.4 MB"). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Display label for a received voice bubble ("Voice message · 0:12" / "Voice message"). */
export function voiceLabel(durationSeconds: number | null | undefined): string {
  if (durationSeconds == null || durationSeconds <= 0) return "Voice message";
  return `Voice message · ${formatMillis(durationSeconds * 1000)}`;
}

/** Display name for a received file chip, falling back when the picker gave no name. */
export function fileLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Attachment";
}

/** Filename for an uploaded voice note (m4a is what the recorder writes by default). */
export function voiceFileName(now = Date.now()): string {
  return `voice-${now}.m4a`;
}

export interface VoiceMeta {
  public_id: string;
  bytes: number;
  name: string;
  duration: number;
  [key: string]: unknown;
}

/** attachment_meta for a sent voice note. duration is whole seconds. */
export function voiceAttachmentMeta(up: { public_id: string; bytes: number }, name: string, durationMs: number): VoiceMeta {
  return { public_id: up.public_id, bytes: up.bytes, name, duration: durationSecs(durationMs) };
}

export interface FileMeta {
  public_id: string;
  bytes: number;
  name: string;
  size: number;
  [key: string]: unknown;
}

/** attachment_meta for a sent file. size mirrors the picker's reported byte size. */
export function fileAttachmentMeta(up: { public_id: string; bytes: number }, name: string, size: number | null | undefined): FileMeta {
  return { public_id: up.public_id, bytes: up.bytes, name, size: size ?? up.bytes };
}
