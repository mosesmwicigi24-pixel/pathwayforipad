// Chat attachment object-key derivation (mobile Chat make). The raw bytes never
// touch our server (§4.5): the client uploads directly to a signed Cloudinary
// PUT URL brokered by MediaService, then sends the chat message referencing the
// object key. Keys are namespaced per author so they're easy to scope/audit.
import { randomUUID } from "node:crypto";

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/gif": ".gif",
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
};

export function extForContentType(contentType: string): string {
  return EXT[contentType.toLowerCase().split(";")[0]!.trim()] ?? "";
}

/** `chat/<userId>/<uuid><ext>` — stable, author-namespaced, collision-free. */
export function attachmentObjectKey(userId: string, contentType: string): string {
  return `chat/${userId}/${randomUUID()}${extForContentType(contentType)}`;
}
