// TOTP (RFC 6238) — admin second factor for step-up MFA (§5.3). Implemented on
// Node's crypto (HMAC-SHA1) plus a small RFC 4648 base32 codec, so there is no
// third-party OTP dependency. Verified against the RFC 6238 test vectors in
// test/mfa.test.ts.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226): a counter-based one-time code. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export interface TotpOptions {
  time?: number; // unix seconds (defaults to now)
  step?: number; // period seconds (default 30)
  digits?: number; // default 6
}

export function totp(secretB32: string, opts: TotpOptions = {}): string {
  const step = opts.step ?? 30;
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  return hotp(base32Decode(secretB32), Math.floor(time / step), opts.digits ?? 6);
}

/**
 * Verify a presented code against a window of ±`window` steps (default ±1, i.e.
 * ~90s tolerance) using a constant-time comparison.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const window = opts.window ?? 1;
  const target = code.trim();
  if (target.length !== digits || !/^\d+$/.test(target)) return false;

  const secret = base32Decode(secretB32);
  const base = Math.floor(time / step);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    // Compare every candidate (no early return) to keep timing uniform.
    if (constantTimeEquals(hotp(secret, base + w, digits), target)) ok = true;
  }
  return ok;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** A fresh 160-bit base32 secret (RFC 4226 recommends ≥128 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for QR-code provisioning into an authenticator app. */
export function otpauthUri(secretB32: string, account: string, issuer = "Nuru Place"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
