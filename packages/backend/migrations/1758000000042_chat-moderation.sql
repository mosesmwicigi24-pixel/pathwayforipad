-- Chat moderation for the portal Chat console (Figma "Final Pathway Portal").
-- Admins/SuperAdmins oversee disciple/group/space threads and act on messages:
-- flag for review (soft, still visible) or remove (hide from members). These
-- columns are server-authoritative — the client never originates moderation
-- state (§1.1). `is_hidden` already exists (the remove target); we add the flag
-- fields plus an audit of who moderated and when.

-- Up Migration

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_flagged   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS flag_reason  TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES users(user_id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE chat_messages DROP COLUMN IF EXISTS moderated_at;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS moderated_by;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS flag_reason;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS is_flagged;
