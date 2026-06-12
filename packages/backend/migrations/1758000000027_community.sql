-- Migration 27 · Community: cohort discussions (Contract Matrix B8)
-- ============================================================================
-- The design's "Community" tab, built as STRUCTURED cell-scoped discussions
-- (threads + comments, leader-moderated) — the recorded decision instead of
-- free-form real-time chat. Visibility is the member's own cell only; leaders
-- moderate within their leader_assignments scope (§5.4). Posts are offline-
-- queueable (client-generated ids, idempotent); moderation-hidden content is
-- tombstoned off members' devices.
-- ============================================================================

-- Up Migration

CREATE TABLE discussion_threads (
  thread_id          UUID PRIMARY KEY,                        -- client-generated (offline-first)
  cell_group_id      UUID NOT NULL REFERENCES cell_groups(cell_group_id),
  author_user_id     UUID NOT NULL REFERENCES users(user_id),
  title              VARCHAR(200) NOT NULL,
  body               TEXT NOT NULL,                           -- Markdown
  is_pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked          BOOLEAN NOT NULL DEFAULT FALSE,          -- no new comments
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,          -- moderation
  hidden_by          UUID REFERENCES users(user_id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_mutation_id UUID UNIQUE
);
CREATE INDEX idx_threads_cell ON discussion_threads (cell_group_id, is_pinned DESC, created_at DESC);

CREATE TABLE discussion_comments (
  comment_id         UUID PRIMARY KEY,                        -- client-generated
  thread_id          UUID NOT NULL REFERENCES discussion_threads(thread_id) ON DELETE CASCADE,
  cell_group_id      UUID NOT NULL REFERENCES cell_groups(cell_group_id), -- denormalized for sync scope
  author_user_id     UUID NOT NULL REFERENCES users(user_id),
  body               TEXT NOT NULL,
  is_hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_by          UUID REFERENCES users(user_id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_mutation_id UUID UNIQUE
);
CREATE INDEX idx_comments_thread ON discussion_comments (thread_id, created_at);

-- Down Migration

DROP TABLE IF EXISTS discussion_comments;
DROP TABLE IF EXISTS discussion_threads;
