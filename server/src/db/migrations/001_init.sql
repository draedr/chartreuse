-- ============ core entities ============

CREATE TABLE characters (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  personality   TEXT NOT NULL DEFAULT '',
  scenario      TEXT NOT NULL DEFAULT '',
  first_mes     TEXT NOT NULL DEFAULT '',
  mes_example   TEXT NOT NULL DEFAULT '',
  creator_notes TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  post_history_instructions TEXT NOT NULL DEFAULT '',
  creator       TEXT NOT NULL DEFAULT '',
  character_version TEXT NOT NULL DEFAULT '',
  spec          TEXT NOT NULL,
  spec_version  TEXT NOT NULL DEFAULT '',
  extensions_json TEXT NOT NULL DEFAULT '{}',
  raw_json      TEXT NOT NULL,
  source_hash   TEXT NOT NULL UNIQUE,
  original_hash TEXT NOT NULL,
  original_ext  TEXT NOT NULL CHECK (original_ext IN ('png', 'json')),
  original_filename TEXT NOT NULL,
  has_avatar    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_characters_name    ON characters(name COLLATE NOCASE);
CREATE INDEX idx_characters_creator ON characters(creator COLLATE NOCASE);

CREATE TABLE alternate_greetings (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  content      TEXT NOT NULL,
  PRIMARY KEY (character_id, position)
);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE character_tags (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, tag_id)
);
CREATE INDEX idx_character_tags_tag ON character_tags(tag_id);

CREATE TABLE lorebooks (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  origin       TEXT NOT NULL CHECK (origin IN ('embedded', 'standalone')),
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  scan_depth   INTEGER,
  token_budget INTEGER,
  recursive_scanning INTEGER,
  extensions_json TEXT NOT NULL DEFAULT '{}',
  raw_json     TEXT NOT NULL,
  source_hash  TEXT NOT NULL UNIQUE,
  original_hash TEXT,
  original_filename TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((origin = 'embedded') = (character_id IS NOT NULL))
);
CREATE INDEX idx_lorebooks_character ON lorebooks(character_id);

CREATE TABLE lorebook_entries (
  id           INTEGER PRIMARY KEY,
  lorebook_id  INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  position_idx INTEGER NOT NULL,
  source_uid   TEXT,
  content      TEXT NOT NULL DEFAULT '',
  comment      TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  constant     INTEGER NOT NULL DEFAULT 0,
  selective    INTEGER NOT NULL DEFAULT 0,
  insertion_order INTEGER NOT NULL DEFAULT 0,
  insert_position TEXT NOT NULL DEFAULT '',
  case_sensitive INTEGER,
  priority     INTEGER,
  probability  INTEGER,
  keys_json           TEXT NOT NULL DEFAULT '[]',
  secondary_keys_json TEXT NOT NULL DEFAULT '[]',
  extensions_json     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_entries_lorebook ON lorebook_entries(lorebook_id);

CREATE TABLE entry_keys (
  entry_id  INTEGER NOT NULL REFERENCES lorebook_entries(id) ON DELETE CASCADE,
  key       TEXT NOT NULL COLLATE NOCASE,
  secondary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, key, secondary)
);
CREATE INDEX idx_entry_keys_key ON entry_keys(key);

-- ============ import bookkeeping ============

CREATE TABLE import_files (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('card', 'lorebook')),
  file_hash   TEXT NOT NULL,
  source_hash TEXT,
  entity_type TEXT CHECK (entity_type IN ('character', 'lorebook')),
  entity_id   INTEGER,
  status      TEXT NOT NULL CHECK (status IN ('imported', 'duplicate', 'updated', 'quarantined', 'deleted')),
  error       TEXT,
  first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE import_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  path        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  entity_type TEXT,
  entity_id   INTEGER
);
CREATE INDEX idx_import_log_at ON import_log(at DESC);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============ fulltext search ============
-- Ordinary FTS5 tables (not contentless/external-content): tags, greetings and
-- lorebook entries live in child tables, so no single content table can back the
-- index, and contentless tables cannot serve snippet()/highlight(). The repository
-- rewrites the FTS row inside every entity write transaction; the triggers below
-- only cover deletes (including FK cascades).

CREATE VIRTUAL TABLE characters_fts USING fts5(
  name, creator, tags, description, personality, scenario, first_mes,
  mes_example, alternate_greetings, creator_notes, system_prompt,
  post_history_instructions,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE lorebooks_fts USING fts5(
  name, description, entry_keys, entry_content, entry_comments,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_characters_fts_delete AFTER DELETE ON characters BEGIN
  DELETE FROM characters_fts WHERE rowid = old.id;
END;

CREATE TRIGGER trg_lorebooks_fts_delete AFTER DELETE ON lorebooks BEGIN
  DELETE FROM lorebooks_fts WHERE rowid = old.id;
END;
