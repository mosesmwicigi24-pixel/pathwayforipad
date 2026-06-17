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
import { z } from "zod";
import { maybeOne, one, many, tx, audit, type Queryable } from "../../db/db.js";
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

  /** Public verification: recompute the hash + signature and report validity (§5.5).
   *  A revoked certificate verifies as invalid (with the revocation surfaced). */
  async verify(code: string): Promise<Record<string, unknown>> {
    const cert = await maybeOne<{
      user_id: string;
      level_number: number | null;
      content_hash: string;
      signature: string;
      issued_at: string;
      revoked_at: string | null;
      full_name: string;
    }>(
      this.pool,
      `SELECT c.user_id, c.level_number, c.content_hash, c.signature, c.issued_at, c.revoked_at, u.full_name
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
    const intact = recomputedHash === cert.content_hash && this.sign(cert.content_hash) === cert.signature;
    const revoked = cert.revoked_at !== null;

    return {
      valid: intact && !revoked,
      revoked,
      recipient_name: cert.full_name,
      level_number: cert.level_number,
      issued_at: cert.issued_at,
      verification_code: code,
      content_hash: cert.content_hash,
      signature: cert.signature,
    };
  }

  // ---------------- Admin (ERP, Contract Matrix B1) ----------------

  static readonly ListAdmin = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().optional(), // keyset on issued_at ISO
  });

  /** Issued-certificates register for the portal (newest first). */
  async listAll(q: z.infer<typeof CertificateService.ListAdmin>): Promise<{ data: unknown[]; next_cursor: string | null }> {
    const params: unknown[] = [];
    let where = "TRUE";
    if (q.before) {
      params.push(q.before);
      where = `c.issued_at < $${params.length}`;
    }
    params.push(q.limit + 1);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT c.certificate_id, c.user_id, u.full_name, c.level_number, lv.title AS level_title,
              c.verification_code, c.issued_at, c.revoked_at, c.revoked_reason,
              c.content_hash, c.signature
         FROM certificates c
         JOIN users u ON u.user_id = c.user_id
         LEFT JOIN levels lv ON lv.level_number = c.level_number
        WHERE ${where}
        ORDER BY c.issued_at DESC
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return { data: page, next_cursor: hasMore && last ? String(last.issued_at) : null };
  }

  static readonly AdminIssue = z
    .object({ user_id: z.string().uuid(), level_number: z.number().int().min(1).nullable() })
    .strict();

  /** Manual issuance from the portal (idempotent via issue()); audited. */
  async adminIssue(adminId: string, input: z.infer<typeof CertificateService.AdminIssue>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const user = await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.user_id]);
      if (!user) throw new ApiError("NOT_FOUND", "Member not found");
      const cert = await this.issue(input.user_id, input.level_number, c);
      await audit(c, adminId, "certificate.issued_manually", "certificates", cert.certificate_id, {
        user_id: input.user_id,
        level_number: input.level_number,
      });
      return cert;
    });
  }

  static readonly Revoke = z.object({ reason: z.string().min(5).max(500) }).strict();

  /** Data-correction revocation: reason required, audited, verify() turns invalid. */
  async revoke(adminId: string, certificateId: string, reason: string): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const updated = await maybeOne<{ certificate_id: string }>(
        c,
        `UPDATE certificates SET revoked_at = now(), revoked_reason = $2, revoked_by = $3
          WHERE certificate_id = $1 AND revoked_at IS NULL
          RETURNING certificate_id`,
        [certificateId, reason, adminId],
      );
      if (!updated) throw new ApiError("NOT_FOUND", "Certificate not found or already revoked");
      await audit(c, adminId, "certificate.revoked", "certificates", certificateId, { reason });
      return one(
        c,
        `SELECT certificate_id, user_id, level_number, verification_code, issued_at, revoked_at, revoked_reason
           FROM certificates WHERE certificate_id = $1`,
        [certificateId],
      );
    });
  }
}
