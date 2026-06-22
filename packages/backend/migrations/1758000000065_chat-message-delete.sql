-- Author self-delete for chat messages. Distinct from moderation (is_hidden /
-- hidden_by): a member may soft-delete their OWN message; deleted messages are
-- excluded from every conversation read. Edits reuse the existing is_edited flag.

-- Up Migration

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE chat_messages DROP COLUMN IF EXISTS deleted_at;
