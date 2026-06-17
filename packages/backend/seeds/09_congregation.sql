-- Default congregation (branch/assembly). Every cell + member belongs to one,
-- and the "Register a new cell" flow requires at least one to exist (§2). Seeds a
-- single TGNM branch ONLY when the table is empty, so it never interferes with
-- congregations created or renamed via the System → Congregations admin page.
INSERT INTO congregations (name, country, timezone)
SELECT 'TGNM', 'KE', 'Africa/Nairobi'
WHERE NOT EXISTS (SELECT 1 FROM congregations);
