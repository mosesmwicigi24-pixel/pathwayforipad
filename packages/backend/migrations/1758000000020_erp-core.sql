-- Migration 20 · ERP core (Design Contract Matrix B1)
-- ============================================================================
-- Certificate revocation (web portal: "Revoked with reason", "Revocation
-- policy"). Revocation is a data-correction path: audited, reason required,
-- and the public verify endpoint reports a revoked certificate as invalid.
-- ============================================================================

-- Up Migration

ALTER TABLE certificates
  ADD COLUMN revoked_at     TIMESTAMPTZ,
  ADD COLUMN revoked_reason TEXT,
  ADD COLUMN revoked_by     UUID REFERENCES users(user_id);

CREATE INDEX idx_certificates_issued ON certificates (issued_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_certificates_issued;
ALTER TABLE certificates
  DROP COLUMN IF EXISTS revoked_by,
  DROP COLUMN IF EXISTS revoked_reason,
  DROP COLUMN IF EXISTS revoked_at;
