-- Discipler profile fields on users. Disciplers (rbac_user_roles.role_key in
-- 'discipler'/'mentor') are surfaced in the mobile Home "Meet your discipler"
-- carousel, which needs a short personal message and a thumbnail photo. These
-- are descriptive profile fields the admin sets on the Users page; they do not
-- affect gating/scoring (§1.1).

-- Up Migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS discipler_message TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url        VARCHAR(500);

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS discipler_message;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
