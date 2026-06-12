-- ============ personas ============
-- User-authored personas: name + markdown description + PNG avatar, optional
-- colored group. Connections to characters live ONLY on the persona side.

CREATE TABLE persona_groups (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL  -- '#rrggbb', validated at the API layer
);

CREATE TABLE personas (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  group_id    INTEGER REFERENCES persona_groups(id) ON DELETE SET NULL,
  has_avatar  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_personas_name  ON personas(name COLLATE NOCASE);
CREATE INDEX idx_personas_group ON personas(group_id);

CREATE TABLE persona_characters (
  persona_id   INTEGER NOT NULL REFERENCES personas(id)   ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (persona_id, character_id)
);
CREATE INDEX idx_persona_characters_character ON persona_characters(character_id);
