-- Migration 37 · Direct messaging + Spaces/Groups chat (mobile "Chat" make).
-- ============================================================================
-- A unified messaging domain backing the new mobile Chat tab:
--   • kind='dm'    — a 1:1 direct conversation between two members
--   • kind='group' — a cell's private room (auto-membership = the cell's members)
--   • kind='space' — a public, joinable room within a congregation
-- Messages are offline-queueable (client-generated message_id + client_mutation_id
-- replays are no-ops, §1.7/§3.6). Membership is server-authoritative (§5.4): a
-- member only reads conversations they belong to, or public spaces in their
-- congregation. Hiding is moderation, not deletion (audit trail preserved).
-- ============================================================================

-- Up Migration

CREATE TABLE chat_conversations (
  conversation_id    UUID PRIMARY KEY,
  kind               VARCHAR(8) NOT NULL CHECK (kind IN ('dm', 'group', 'space')),
  title              VARCHAR(200),            -- groups/spaces; DMs derive title from the other member
  topic              VARCHAR(300),
  congregation_id    UUID REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  cell_group_id      UUID REFERENCES cell_groups(cell_group_id) ON DELETE CASCADE, -- the bound cell for a group
  is_public          BOOLEAN NOT NULL DEFAULT FALSE,  -- spaces are discoverable + joinable
  created_by         UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One group room per cell (idempotent ensure-on-read).
CREATE UNIQUE INDEX uq_chat_group_per_cell ON chat_conversations(cell_group_id) WHERE kind = 'group';

CREATE TABLE chat_members (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role            VARCHAR(8) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);

CREATE TABLE chat_messages (
  message_id         UUID PRIMARY KEY,
  conversation_id    UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  author_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body               TEXT NOT NULL DEFAULT '',
  msg_type           VARCHAR(8) NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text', 'voice', 'image', 'file', 'video')),
  attachment_url     TEXT,                    -- signed media URL (§4.5); never raw bytes
  attachment_meta    JSONB,                   -- { duration, size, name, waveform[] }
  reply_to_id        UUID REFERENCES chat_messages(message_id) ON DELETE SET NULL,
  ai_tag             VARCHAR(12) CHECK (ai_tag IN ('prayer', 'action', 'important')),
  is_edited          BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_convo ON chat_messages(conversation_id, created_at);

CREATE TABLE chat_reactions (
  message_id UUID NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  emoji      VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Down Migration

DROP TABLE IF EXISTS chat_reactions;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_members;
DROP TABLE IF EXISTS chat_conversations;
