-- Migration 45 · Members page (Figma) — programme, gender 'other', graduation
-- ============================================================================
-- The Final Pathway Portal Members screen (FIGMA_DIFF_INVENTORY §4) adds member
-- fields beyond the live model. Most already exist:
--   - gender : migration 25 (VARCHAR(20), CHECK male/female/prefer_not_to_say)
--   - city   : migration 25
--   - country_code / locale (language) : migrations 35 / 1
-- This migration closes the remaining gaps:
--
--   1. gender — Figma offers Female/Male/Other. The live CHECK only allows
--      male/female/prefer_not_to_say. We widen the CHECK to also allow 'other'
--      (keeping prefer_not_to_say for backward compatibility with existing rows
--      and the mobile Profile tab). Stored lowercase.
--
--   2. programme — Figma "programme/track" (New believer / Foundations /
--      Serving track / Leadership prep). New nullable text column on users.
--      Free-ish text (CHECK to the four known tracks, NULL allowed) so the web
--      can present a fixed select while leaving room for an "unset" member.
--
--   3. graduated_at — lifecycle flag, NOT an engagement band. The engagement
--      band stays SERVER-computed (§1.1); "Graduated" is a distinct lifecycle
--      state an admin sets explicitly. It lives on ENROLLMENTS, alongside
--      current_level / state / completed_at (the member's pathway lifecycle),
--      not on users. NULL = not graduated; a timestamp = graduated at that time.
-- ============================================================================

-- Up Migration

-- 1. Widen the gender CHECK to include 'other' (Figma Female/Male/Other).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check;
ALTER TABLE users
  ADD CONSTRAINT users_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'other', 'prefer_not_to_say'));

-- 2. programme / track.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS programme VARCHAR(40)
    CHECK (programme IS NULL OR programme IN
      ('new_believer', 'foundations', 'serving_track', 'leadership_prep'));

-- 3. Graduation lifecycle flag on enrollments (where the pathway lifecycle lives).
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE enrollments DROP COLUMN IF EXISTS graduated_at;

ALTER TABLE users DROP COLUMN IF EXISTS programme;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check;
ALTER TABLE users
  ADD CONSTRAINT users_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'prefer_not_to_say'));
