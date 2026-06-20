-- Migration 50 · Chat space category tag (mobile "Nuru Connect" make).
-- ============================================================================
-- Public spaces in the make carry a short category label shown as a pill in the
-- inbox and Discover list (YOUTH, MARKETPLACE, SERVICE, DISCIPLESHIP, …). It's a
-- free-form short tag set when the space is created; only spaces use it (DMs and
-- group rooms leave it null). Additive, forward-only.
-- ============================================================================

-- Up Migration

ALTER TABLE chat_conversations ADD COLUMN category VARCHAR(24);

-- Down Migration

ALTER TABLE chat_conversations DROP COLUMN category;
