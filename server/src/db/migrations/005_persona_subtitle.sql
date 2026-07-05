-- ============ persona subtitle ============
-- Short text shown under the persona's name in list tiles.

ALTER TABLE personas ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
