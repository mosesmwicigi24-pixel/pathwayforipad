-- A member-facing summary of each level for the Pathway "Your journey" cards —
-- one or two sentences capturing what the whole level is about. CMS-editable
-- (Level Detail page); does not affect §1.9 gating. Backfilled with discipleship
-- stage summaries for the standard 7-level journey (only where still null).

-- Up Migration

ALTER TABLE levels ADD COLUMN description TEXT;

UPDATE levels SET description = CASE level_number
  WHEN 1 THEN 'The bedrock of a new life in Christ — assurance of salvation, the Word, prayer, and baptism. Where the journey begins.'
  WHEN 2 THEN 'Growing roots — daily devotion, walking with the Holy Spirit, and building habits that make faith a way of life.'
  WHEN 3 THEN 'Belonging — life together in your cell and church: fellowship, accountability, and walking closely with a discipler.'
  WHEN 4 THEN 'Serving — discovering the gifts God has placed in you and stepping into your place in the body of Christ.'
  WHEN 5 THEN 'Sharing your faith — telling your story with confidence and leading others to Jesus.'
  WHEN 6 THEN 'Discipling others — walking with people the way you have been walked with, and making disciples who make disciples.'
  WHEN 7 THEN 'Multiplying — raising leaders and reproducing the whole journey in others, for generations to come.'
  ELSE NULL
END
WHERE description IS NULL;

-- Down Migration

ALTER TABLE levels DROP COLUMN IF EXISTS description;
