-- ============ chats ============
-- SillyTavern-formatted .jsonl chat backups, uploaded against a character.
-- The raw .jsonl is stored byte-for-byte on disk (DATA_DIR/chats/{id}.jsonl);
-- this row holds only the metadata needed to list and label it. Deleting the
-- character (or the chat) drops the row; the file is removed at the API layer.

CREATE TABLE chats (
  id                INTEGER PRIMARY KEY,
  character_id      INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  user_name         TEXT NOT NULL DEFAULT '',
  character_name    TEXT NOT NULL DEFAULT '',
  create_date       TEXT NOT NULL DEFAULT '',
  message_count     INTEGER NOT NULL DEFAULT 0,
  file_size         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chats_character ON chats(character_id);
