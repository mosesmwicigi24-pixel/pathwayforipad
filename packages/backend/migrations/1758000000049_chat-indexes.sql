-- Migration 49 · Chat performance indexes (DB-speed pass for the Chat make).
-- ============================================================================
-- The inbox/thread/discover/moderation queries built in modules/chat all filter
-- on the same few shapes. Without these, Postgres falls back to seq scans on
-- chat_messages/chat_conversations as those tables grow, which is what makes the
-- mobile Chat tab feel slow to load. Each index below targets one hot query:
--
--   • Inbox preview + unread count — the LATERAL "last visible message" and the
--     unread subquery both scan chat_messages by conversation, newest-first,
--     skipping hidden rows. A partial (conversation_id, created_at DESC) index
--     WHERE NOT is_hidden serves both without reading moderated rows.
--   • Discover spaces — listConversations filters public spaces by congregation.
--   • Moderation flagged count — listAllForModeration counts flagged-not-hidden
--     messages per conversation.
--
-- All are additive (CREATE INDEX); no data change, forward-only.
-- ============================================================================

-- Up Migration

-- Inbox "last message" LATERAL + unread count both want newest visible message
-- per conversation. Ordering DESC matches the LIMIT 1 / range scans; the partial
-- predicate keeps moderated (hidden) rows out of the index entirely.
CREATE INDEX idx_chat_messages_visible
  ON chat_messages (conversation_id, created_at DESC)
  WHERE NOT is_hidden;

-- Discoverable public spaces within a congregation (listConversations.discover).
CREATE INDEX idx_chat_conversations_discover
  ON chat_conversations (congregation_id)
  WHERE kind = 'space' AND is_public;

-- Per-conversation flagged-but-visible count for the moderation inbox.
CREATE INDEX idx_chat_messages_flagged
  ON chat_messages (conversation_id)
  WHERE is_flagged AND NOT is_hidden;

-- Down Migration

DROP INDEX IF EXISTS idx_chat_messages_flagged;
DROP INDEX IF EXISTS idx_chat_conversations_discover;
DROP INDEX IF EXISTS idx_chat_messages_visible;
