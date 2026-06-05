-- Migration 11 · SSO-provisioning accommodation (DEVIATION, flagged)
-- ============================================================================
-- The API (§3.3) provisions a user at OAuth first-login (POST /v1/auth/oauth/
-- {provider}), but the baseline intake — date_of_birth, phone_number — only
-- arrives later at onboarding (POST /v1/me/onboarding). The §2 DDL marks both
-- NOT NULL, which makes first-login provisioning impossible. The spec already
-- makes email/password_hash nullable for exactly this SSO reason; we extend the
-- same treatment to date_of_birth and phone_number.
--
-- Onboarding enforces both as required before it instantiates the enrollment, so
-- no "active" member ever lacks them — the nullability only covers the brief
-- provisioned-but-not-yet-onboarded window. The is_minor trigger is hardened to
-- treat an unknown DOB as non-minor (FALSE) until onboarding supplies it.
-- ============================================================================

-- Up Migration

ALTER TABLE users ALTER COLUMN date_of_birth   DROP NOT NULL;
ALTER TABLE users ALTER COLUMN phone_number    DROP NOT NULL;
-- congregation is derived from the cell the member picks at onboarding, so it is
-- unknown during the provisioned-but-not-yet-onboarded window. Onboarding sets it
-- (and enforces it) before the enrollment is created.
ALTER TABLE users ALTER COLUMN congregation_id DROP NOT NULL;

-- PATCH /v1/me uses an optimistic-concurrency row_version (§3.3, §1.7 "Profile
-- fields: server-authoritative with version check"), but the §2 users DDL has no
-- such column. Add it; the service bumps it on every profile update and returns
-- 409 VERSION_STALE on mismatch.
ALTER TABLE users ADD COLUMN row_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION fn_set_is_minor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_minor := COALESCE(NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years'), FALSE);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION fn_set_is_minor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_minor := NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER TABLE users DROP COLUMN IF EXISTS row_version;
ALTER TABLE users ALTER COLUMN congregation_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone_number    SET NOT NULL;
ALTER TABLE users ALTER COLUMN date_of_birth   SET NOT NULL;
