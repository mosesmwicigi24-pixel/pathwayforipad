-- Cell metadata for the portal "New Cell" flow (Figma "Register a new cell").
-- Engagement scores stay server-authoritative and derived (§1.1) — these columns
-- only carry the descriptive fields the admin captures when registering a cell:
-- the discipler's display name/role, focus, curriculum level label, meeting
-- cadence text, room, next session, and a card colour tone.

-- Up Migration

ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS discipler_name VARCHAR(150);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS discipler_role VARCHAR(80);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS focus          VARCHAR(200);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS level_label    VARCHAR(120);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS meets          VARCHAR(120);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS room           VARCHAR(120);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS next_session   VARCHAR(160);
ALTER TABLE cell_groups ADD COLUMN IF NOT EXISTS tone           VARCHAR(20);

-- Down Migration

ALTER TABLE cell_groups DROP COLUMN IF EXISTS discipler_name;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS discipler_role;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS focus;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS level_label;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS meets;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS room;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS next_session;
ALTER TABLE cell_groups DROP COLUMN IF EXISTS tone;
