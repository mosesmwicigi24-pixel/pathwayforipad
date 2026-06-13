-- Migration 29 · Growth content (Contract Matrix D5 — mobile Pathway growth)
-- ============================================================================
-- Backs the growth sub-screens with real, server-owned content + per-member
-- progress: daily devotionals, a memory-verse library (with mastery), reading
-- plans (with days + enrollment/progress), a resource library, and mentor
-- meeting notes. Content tables are church-curated (seeded/admin-editable);
-- per-user state is private to the member (§5.4). Progress writes are
-- idempotent on (user, item) for offline-tolerant replay (§3.6).
-- ============================================================================

-- Up Migration

-- ── Devotionals (one per day_number; "today" = highest published ≤ today) ──
CREATE TABLE devotionals (
  devotional_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number        INT NOT NULL UNIQUE,
  series            VARCHAR(120),
  title             VARCHAR(200) NOT NULL,
  scripture_ref     VARCHAR(80),
  scripture_text    TEXT,
  body              TEXT NOT NULL,                 -- Markdown
  reflection_prompt TEXT,
  audio_url         VARCHAR(512),
  video_url         VARCHAR(512),
  is_published      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Memory verses (shared library) + per-member mastery ──
CREATE TABLE memory_verses (
  memory_verse_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       VARCHAR(80) NOT NULL,
  verse_text      TEXT NOT NULL,
  version         VARCHAR(12) NOT NULL DEFAULT 'WEB',
  week_number     INT,                             -- nullable: library vs weekly
  sort            INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE memory_verse_progress (
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  memory_verse_id UUID NOT NULL REFERENCES memory_verses(memory_verse_id) ON DELETE CASCADE,
  status          VARCHAR(10) NOT NULL DEFAULT 'learning' CHECK (status IN ('learning','mastered')),
  best_match_pct  INT NOT NULL DEFAULT 0 CHECK (best_match_pct BETWEEN 0 AND 100),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, memory_verse_id)
);

-- ── Reading plans + days + per-member progress ──
CREATE TABLE reading_plans (
  plan_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(40) UNIQUE NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  category    VARCHAR(80),
  day_count   INT NOT NULL CHECK (day_count > 0),
  sort        INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE reading_plan_days (
  plan_day_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  day_number  INT NOT NULL,
  reference   VARCHAR(120) NOT NULL,
  title       VARCHAR(200),
  content     TEXT,
  UNIQUE (plan_id, day_number)
);
CREATE TABLE reading_plan_progress (
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id      UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  current_day  INT NOT NULL DEFAULT 1,
  completed_days INT[] NOT NULL DEFAULT '{}',      -- day_numbers marked done
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, plan_id)
);

-- ── Resource library ──
CREATE TABLE resources (
  resource_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(200) NOT NULL,
  author         VARCHAR(160),
  kind           VARCHAR(12) NOT NULL CHECK (kind IN ('book','audio','video','article')),
  duration_label VARCHAR(40),                      -- "184 pages" / "42 min"
  url            VARCHAR(512),
  sort           INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Mentor meeting notes (the discipler relationship itself is in
--    relationship_tree / leader_assignments; this is the conversation log) ──
CREATE TABLE mentor_notes (
  note_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,  -- the disciple
  mentor_user_id UUID REFERENCES users(user_id),
  topic          VARCHAR(200) NOT NULL,
  note           TEXT,
  met_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_meeting_at TIMESTAMPTZ
);
CREATE INDEX idx_mentor_notes_user ON mentor_notes (user_id, met_at DESC);

-- Down Migration

DROP TABLE IF EXISTS mentor_notes;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS reading_plan_progress;
DROP TABLE IF EXISTS reading_plan_days;
DROP TABLE IF EXISTS reading_plans;
DROP TABLE IF EXISTS memory_verse_progress;
DROP TABLE IF EXISTS memory_verses;
DROP TABLE IF EXISTS devotionals;
