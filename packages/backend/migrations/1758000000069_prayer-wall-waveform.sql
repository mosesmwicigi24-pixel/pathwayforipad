-- Persist the voice-note waveform so the amplitude bars render for everyone who
-- views a post/comment, not just the recorder. We store a compact array of
-- normalized peak amplitudes (0–100 ints, ~40 bars) captured from the mic meter
-- while recording. jsonb keeps it queryless and forward-compatible.

-- Up Migration

ALTER TABLE prayer_wall_posts    ADD COLUMN audio_waveform JSONB;
ALTER TABLE prayer_wall_comments ADD COLUMN audio_waveform JSONB;

-- Down Migration

ALTER TABLE prayer_wall_posts    DROP COLUMN IF EXISTS audio_waveform;
ALTER TABLE prayer_wall_comments DROP COLUMN IF EXISTS audio_waveform;
