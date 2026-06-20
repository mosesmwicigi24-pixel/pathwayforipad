// Password hashing (spec §5.5) — Argon2id for the rare credential accounts; the
// majority are SSO-only with no stored secret.
import argon2 from "argon2";

// Argon2id at the OWASP-recommended minimum (m=19 MiB, t=2, p=1). The node-argon2
// default is m=64 MiB / t=3, which on a small, swap-less host takes 15-18 s per
// verify under memory pressure and blows the mobile client's request timeout —
// making login look like "can't reach the server". 19 MiB / 2 passes keeps the
// cost secure while bringing verify back to well under a second. Params are
// embedded in each hash, so older (heavier) hashes still verify; loginWithPassword
// transparently re-hashes them on the next successful sign-in (see passwordNeedsRehash).
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when an existing hash was made with different (e.g. heavier, legacy)
 *  parameters and should be re-hashed to the current profile on next login. */
export function passwordNeedsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
