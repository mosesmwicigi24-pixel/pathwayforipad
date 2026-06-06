// Certificates (spec §2, §5.5). Issuance is tamper-evident, not blockchain — a
// content hash over the issuance facts plus a detached signature, both verifiable
// at a public /verify/{code} endpoint. Issuance is idempotent (one per
// user+level) and driven by the outbox on reflection approval (Flow B).
//
// The signature here is HMAC-SHA256 with CERT_SIGNING_KEY as a stand-in for the
// spec's KMS detached signature (§5.5) — production swaps in an asymmetric KMS
// key so verifiers need only the public half. Flagged.
import type { Pool, PoolClient } from "pg";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { maybeOne, one, many, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { renderCertificatePdf } from "./pdf.js";
import type { ObjectStore } from "./objectStore.js";

function contentHash(facts: { user_id: string; level_number: number | null; verification_code: string }): string {
  // Bind to the immutable verification_code (round-trips exactly, unlike a
  // TIMESTAMPTZ). user_id + level + code are the meaningful issuance facts.
  const canonical = `${facts.user_id}|${facts.level_number ?? "full"}|${facts.verification_code}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export class CertificateService {
  constructor(
    private readonly pool: Pool,
    private readonly signingKey: string,
    private readonly store?: ObjectStore,
  ) {}

  private sign(hash: string): string {
    return createHmac("sha256", this.signingKey).update(hash).digest("hex");
  }

  /** Idempotently issue the credential for a (user, level). Safe to call from the outbox. */
  async issue(userId: string, levelNumber: number | null, client?: PoolClient): Promise<{ certificate_id: string; verification_code: string }> {
    const c: Queryable = client ?? this.pool;
    const existing = await maybeOne<{ certificate_id: string; verification_code: string }>(
      c,
      `SELECT certificate_id, verification_code FROM certificates
        WHERE user_id = $1 AND level_number IS NOT DISTINCT FROM $2`,
      [userId, levelNumber],
    );
    if (existing) return existing;

    const issuedAt = new Date().toISOString();
    const verificationCode = randomBytes(12).toString("hex").toUpperCase(); // 24 chars
    const hash = contentHash({ user_id: userId, level_number: levelNumber, verification_code: verificationCode });
    const row = await one<{ certificate_id: string; verification_code: string }>(
      c,
      `INSERT INTO certificates (user_id, level_number, verification_code, pdf_object_key, content_hash, signature, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING certificate_id, verification_code`,
      [
        userId,
        levelNumber,
        verificationCode,
        `certificates/${verificationCode}.pdf`, // object-storage key; PDF render is a media job
        hash,
        this.sign(hash),
        issuedAt,
      ],
    );

    // Render + store the PDF (object storage, §4.5). Best-effort: a render/store
    // failure must not lose the issued credential — the row already exists and the
    // PDF can be regenerated.
    if (this.store) {
      try {
        const owner = await maybeOne<{ full_name: string }>(
          c,
          `SELECT full_name FROM users WHERE user_id = $1`,
          [userId],
        );
        const pdf = renderCertificatePdf({
          recipient: owner?.full_name ?? "Member",
          levelLabel: levelNumber == null ? "Full programme" : `Level ${levelNumber}`,
          code: verificationCode,
          issuedAt: issuedAt.slice(0, 10),
        });
        await this.store.put(`certificates/${verificationCode}.pdf`, pdf, "application/pdf");
      } catch {
        // swallow — issuance succeeded; PDF is regenerable
      }
    }
    return row;
  }

  /** The caller's issued certificates with a (placeholder) download reference. */
  async listForUser(userId: string): Promise<unknown[]> {
    const rows = await many<{ verification_code: string; pdf_object_key: string }>(
      this.pool,
      `SELECT certificate_id, level_number, verification_code, pdf_object_key, issued_at
         FROM certificates WHERE user_id = $1 ORDER BY issued_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      ...r,
      download_url: `/media/certificates/${r.verification_code}`, // brokered by the media module
    }));
  }

  /** Public verification: recompute the hash + signature and report validity (§5.5). */
  async verify(code: string): Promise<Record<string, unknown>> {
    const cert = await maybeOne<{
      user_id: string;
      level_number: number | null;
      content_hash: string;
      signature: string;
      issued_at: string;
      full_name: string;
    }>(
      this.pool,
      `SELECT c.user_id, c.level_number, c.content_hash, c.signature, c.issued_at, u.full_name
         FROM certificates c JOIN users u ON u.user_id = c.user_id
        WHERE c.verification_code = $1`,
      [code],
    );
    if (!cert) throw new ApiError("NOT_FOUND", "No certificate with that code");

    const recomputedHash = contentHash({
      user_id: cert.user_id,
      level_number: cert.level_number,
      verification_code: code,
    });
    const valid = recomputedHash === cert.content_hash && this.sign(cert.content_hash) === cert.signature;

    return {
      valid,
      recipient_name: cert.full_name,
      level_number: cert.level_number,
      issued_at: cert.issued_at,
    };
  }
}
