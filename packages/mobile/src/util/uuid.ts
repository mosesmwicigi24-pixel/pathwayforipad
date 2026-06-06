// RFC 4122 v4 UUID. Used for client mutation ids / idempotency keys. Prefers the
// platform crypto when available (Hermes / web), with a Math.random fallback for
// older runtimes — fine for idempotency keys (collision is astronomically rare).
export function uuidv4(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
