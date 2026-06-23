-- Persist the Nuru AI companion thread per member, so quick help survives app
-- restarts and is retrievable. One running thread per user (the make's Nuru
-- panel). Private to the member (§5.4) — never read by leaders/admins.

-- Up Migration

CREATE TABLE assistant_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assistant_messages_user ON assistant_messages (user_id, created_at);

-- Down Migration

DROP TABLE IF EXISTS assistant_messages;
