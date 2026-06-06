// Application-layer encryption for at-rest MFA secrets (§5.3, §5.5). AES-256-GCM
// (authenticated) with a key derived from JWT_SIGNING_KEY via scrypt.
//
// FLAGGED TRADE-OFF: deriving from JWT_SIGNING_KEY couples MFA secrets to the
// access-token signing key — rotating that key would orphan stored secrets.
// Production should supply a dedicated, separately-rotated MFA encryption key
// (managed secrets store, §5.10) and re-seal on rotation. Kept minimal here so
// no secret is ever written in plaintext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

function keyFrom(signingKey: string): Buffer {
  return scryptSync(signingKey, "nuru-mfa-secretbox-v1", 32);
}

/** Seal plaintext → "iv:tag:ciphertext" (all base64). */
export function sealSecret(plain: string, signingKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(signingKey), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Reverse of sealSecret; throws if the ciphertext or tag is tampered. */
export function openSecret(sealed: string, signingKey: string): string {
  const [ivb, tagb, encb] = sealed.split(":");
  if (!ivb || !tagb || !encb) throw new Error("malformed sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(signingKey), Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encb, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
