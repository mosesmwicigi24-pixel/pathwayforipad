-- Migration 35 · RBAC (Final Pathway make — System ▸ Roles & Permissions, Users)
-- ============================================================================
-- Fine-grained role-based access control on top of the coarse users.role enum.
-- A role grants a set of (module_id, capability) permissions; users are assigned
-- one or more roles. The legacy enum (Student/Instructor/Admin/SuperAdmin) stays
-- as the authentication-time coarse gate; the permission matrix layers on top via
-- requirePermission() (§5.4). Forward-only.
--
-- Modules (16) and capabilities (6) are FIXED dimensions mirrored in the web
-- client (systemData). We store only the GRANTED cells; absence = denied.
-- ============================================================================

-- Up Migration

CREATE TABLE rbac_roles (
  role_key    VARCHAR(60) PRIMARY KEY,                 -- stable slug, e.g. 'curriculum_editor'
  name        VARCHAR(120) NOT NULL,
  role_type   VARCHAR(10) NOT NULL CHECK (role_type IN ('system','staff','field')),
  description TEXT NOT NULL DEFAULT '',
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,          -- true = built-in; cannot be deleted
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rbac_role_permissions (
  role_key   VARCHAR(60) NOT NULL REFERENCES rbac_roles(role_key) ON DELETE CASCADE,
  module_id  VARCHAR(40) NOT NULL,                     -- one of the 16 fixed module ids
  capability VARCHAR(12) NOT NULL CHECK (capability IN ('view','create','edit','delete','approve','export')),
  PRIMARY KEY (role_key, module_id, capability)
);

CREATE TABLE rbac_user_roles (
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_key    VARCHAR(60) NOT NULL REFERENCES rbac_roles(role_key) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(user_id),
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX idx_rbac_user_roles_role ON rbac_user_roles (role_key);

-- Portal-account attributes surfaced on the Users screen.
ALTER TABLE users
  ADD COLUMN country_code   VARCHAR(2) REFERENCES countries(code),
  ADD COLUMN account_status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','invited','suspended')),
  ADD COLUMN require_2fa    BOOLEAN NOT NULL DEFAULT FALSE;

-- Down Migration

ALTER TABLE users
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS account_status,
  DROP COLUMN IF EXISTS require_2fa;
DROP TABLE IF EXISTS rbac_user_roles;
DROP TABLE IF EXISTS rbac_role_permissions;
DROP TABLE IF EXISTS rbac_roles;
