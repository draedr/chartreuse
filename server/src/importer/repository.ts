import type { Db } from '../db/connection.js';
import { hashPayload, sha256, stableStringify } from './hash.js';
import type { NormalizedCharacter, NormalizedLorebook } from './normalize.js';

export interface CharacterMeta {
  sourceHash: string;
  /** sha256 of the original file bytes; keys into DATA_DIR/originals. */
  originalHash: string;
  originalExt: 'png' | 'json';
  originalFilename: string;
  hasAvatar: boolean;
}

export interface LorebookMeta {
  sourceHash: string;
  origin: 'embedded' | 'standalone';
  characterId: number | null;
  /** null for embedded books (no standalone original file). */
  originalHash: string | null;
  originalFilename: string | null;
}

export interface ImportFileRow {
  id: number;
  path: string;
  kind: 'card' | 'lorebook';
  file_hash: string;
  source_hash: string | null;
  entity_type: 'character' | 'lorebook' | null;
  entity_id: number | null;
  status: 'imported' | 'duplicate' | 'updated' | 'quarantined' | 'deleted';
  error: string | null;
  first_seen_at: string;
  last_processed_at: string;
}

/** Hash for an embedded book, salted with the parent card's hash so two
 *  characters embedding identical books get separate (cascaded) rows. */
export function embeddedBookHash(parentSourceHash: string, bookRaw: unknown): string {
  return sha256(`${parentSourceHash}:${stableStringify(bookRaw)}`);
}

export { hashPayload };

/**
 * All database writes live here. Every entity write rewrites the entity's FTS
 * row inside the same transaction (single code path, no trigger drift); the
 * schema's AFTER DELETE triggers cover delete/cascade paths.
 */
export class Repository {
  constructor(private readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------- lookups ----------

  findCharacterIdByHash(sourceHash: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM characters WHERE source_hash = ?')
      .get(sourceHash) as { id: number } | undefined;
    return row?.id;
  }

  findLorebookIdByHash(sourceHash: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM lorebooks WHERE source_hash = ?')
      .get(sourceHash) as { id: number } | undefined;
    return row?.id;
  }

  getImportFile(path: string): ImportFileRow | undefined {
    return this.db.prepare('SELECT * FROM import_files WHERE path = ?').get(path) as
      | ImportFileRow
      | undefined;
  }

  // ---------- characters ----------

  insertCharacter(c: NormalizedCharacter, meta: CharacterMeta): number {
    const result = this.db
      .prepare(
        `INSERT INTO characters (
           name, description, personality, scenario, first_mes, mes_example,
           creator_notes, system_prompt, post_history_instructions, creator,
           character_version, spec, spec_version, extensions_json, raw_json,
           source_hash, original_hash, original_ext, original_filename, has_avatar,
           text_length
         ) VALUES (
           @name, @description, @personality, @scenario, @firstMes, @mesExample,
           @creatorNotes, @systemPrompt, @postHistoryInstructions, @creator,
           @characterVersion, @spec, @specVersion, @extensionsJson, @rawJson,
           @sourceHash, @originalHash, @originalExt, @originalFilename, @hasAvatar,
           @textLength
         )`,
      )
      .run({
        ...this.characterParams(c),
        sourceHash: meta.sourceHash,
        originalHash: meta.originalHash,
        originalExt: meta.originalExt,
        originalFilename: meta.originalFilename,
        hasAvatar: meta.hasAvatar ? 1 : 0,
      });
    const id = Number(result.lastInsertRowid);
    this.writeCharacterChildren(id, c, meta.sourceHash);
    this.reindexCharacterFts(id);
    return id;
  }

  updateCharacter(id: number, c: NormalizedCharacter, meta: CharacterMeta): void {
    this.db
      .prepare(
        `UPDATE characters SET
           name = @name, description = @description, personality = @personality,
           scenario = @scenario, first_mes = @firstMes, mes_example = @mesExample,
           creator_notes = @creatorNotes, system_prompt = @systemPrompt,
           post_history_instructions = @postHistoryInstructions, creator = @creator,
           character_version = @characterVersion, spec = @spec,
           spec_version = @specVersion, extensions_json = @extensionsJson,
           raw_json = @rawJson, source_hash = @sourceHash,
           original_hash = @originalHash, original_ext = @originalExt,
           original_filename = @originalFilename,
           has_avatar = @hasAvatar, text_length = @textLength,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        ...this.characterParams(c),
        id,
        sourceHash: meta.sourceHash,
        originalHash: meta.originalHash,
        originalExt: meta.originalExt,
        originalFilename: meta.originalFilename,
        hasAvatar: meta.hasAvatar ? 1 : 0,
      });
    // Replace children wholesale (greetings, tags, embedded book).
    this.db.prepare('DELETE FROM alternate_greetings WHERE character_id = ?').run(id);
    this.db.prepare('DELETE FROM character_tags WHERE character_id = ?').run(id);
    this.db
      .prepare("DELETE FROM lorebooks WHERE character_id = ? AND origin = 'embedded'")
      .run(id);
    this.writeCharacterChildren(id, c, meta.sourceHash);
    this.reindexCharacterFts(id);
  }

  deleteCharacter(id: number): boolean {
    const res = this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private characterParams(c: NormalizedCharacter) {
    // Mirrors the backfill in 002_text_length.sql: prompt-relevant text only.
    const textLength = [
      c.description,
      c.personality,
      c.scenario,
      c.firstMes,
      c.mesExample,
      c.systemPrompt,
      c.postHistoryInstructions,
      ...c.alternateGreetings,
    ].reduce((n, s) => n + s.length, 0);
    return {
      textLength,
      name: c.name,
      description: c.description,
      personality: c.personality,
      scenario: c.scenario,
      firstMes: c.firstMes,
      mesExample: c.mesExample,
      creatorNotes: c.creatorNotes,
      systemPrompt: c.systemPrompt,
      postHistoryInstructions: c.postHistoryInstructions,
      creator: c.creator,
      characterVersion: c.characterVersion,
      spec: c.spec,
      specVersion: c.specVersion,
      extensionsJson: JSON.stringify(c.extensions),
      rawJson: JSON.stringify(c.raw),
    };
  }

  private writeCharacterChildren(
    id: number,
    c: NormalizedCharacter,
    sourceHash: string,
  ): void {
    const insGreeting = this.db.prepare(
      'INSERT INTO alternate_greetings (character_id, position, content) VALUES (?, ?, ?)',
    );
    c.alternateGreetings.forEach((g, i) => insGreeting.run(id, i, g));

    const insTag = this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTag = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = this.db.prepare(
      'INSERT OR IGNORE INTO character_tags (character_id, tag_id) VALUES (?, ?)',
    );
    for (const tag of c.tags) {
      insTag.run(tag);
      const { id: tagId } = getTag.get(tag) as { id: number };
      linkTag.run(id, tagId);
    }

    if (c.book) {
      this.insertLorebook(c.book, {
        sourceHash: embeddedBookHash(sourceHash, c.book.raw),
        origin: 'embedded',
        characterId: id,
        originalHash: null,
        originalFilename: null,
      });
    }
  }

  // ---------- lorebooks ----------

  insertLorebook(lb: NormalizedLorebook, meta: LorebookMeta): number {
    const result = this.db
      .prepare(
        `INSERT INTO lorebooks (
           name, description, origin, character_id, scan_depth, token_budget,
           recursive_scanning, extensions_json, raw_json, source_hash,
           original_hash, original_filename
         ) VALUES (
           @name, @description, @origin, @characterId, @scanDepth, @tokenBudget,
           @recursiveScanning, @extensionsJson, @rawJson, @sourceHash,
           @originalHash, @originalFilename
         )`,
      )
      .run({ ...this.lorebookParams(lb), ...this.lorebookMetaParams(meta) });
    const id = Number(result.lastInsertRowid);
    this.writeLorebookEntries(id, lb);
    this.reindexLorebookFts(id);
    return id;
  }

  updateLorebook(id: number, lb: NormalizedLorebook, meta: LorebookMeta): void {
    this.db
      .prepare(
        `UPDATE lorebooks SET
           name = @name, description = @description, origin = @origin,
           character_id = @characterId, scan_depth = @scanDepth,
           token_budget = @tokenBudget, recursive_scanning = @recursiveScanning,
           extensions_json = @extensionsJson, raw_json = @rawJson,
           source_hash = @sourceHash, original_hash = @originalHash,
           original_filename = @originalFilename,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...this.lorebookParams(lb), ...this.lorebookMetaParams(meta), id });
    this.db.prepare('DELETE FROM lorebook_entries WHERE lorebook_id = ?').run(id);
    this.writeLorebookEntries(id, lb);
    this.reindexLorebookFts(id);
  }

  deleteLorebook(id: number): boolean {
    const res = this.db.prepare('DELETE FROM lorebooks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private lorebookParams(lb: NormalizedLorebook) {
    return {
      name: lb.name,
      description: lb.description,
      scanDepth: lb.scanDepth,
      tokenBudget: lb.tokenBudget,
      recursiveScanning:
        lb.recursiveScanning === null ? null : lb.recursiveScanning ? 1 : 0,
      extensionsJson: JSON.stringify(lb.extensions),
      rawJson: JSON.stringify(lb.raw),
    };
  }

  private lorebookMetaParams(meta: LorebookMeta) {
    return {
      origin: meta.origin,
      characterId: meta.characterId,
      sourceHash: meta.sourceHash,
      originalHash: meta.originalHash,
      originalFilename: meta.originalFilename,
    };
  }

  private writeLorebookEntries(id: number, lb: NormalizedLorebook): void {
    const insEntry = this.db.prepare(
      `INSERT INTO lorebook_entries (
         lorebook_id, position_idx, source_uid, content, comment, enabled,
         constant, selective, insertion_order, insert_position, case_sensitive,
         priority, probability, keys_json, secondary_keys_json, extensions_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insKey = this.db.prepare(
      'INSERT OR IGNORE INTO entry_keys (entry_id, key, secondary) VALUES (?, ?, ?)',
    );
    lb.entries.forEach((e, i) => {
      const res = insEntry.run(
        id,
        i,
        e.sourceUid,
        e.content,
        e.comment,
        e.enabled ? 1 : 0,
        e.constant ? 1 : 0,
        e.selective ? 1 : 0,
        e.insertionOrder,
        e.insertPosition,
        e.caseSensitive === null ? null : e.caseSensitive ? 1 : 0,
        e.priority,
        e.probability,
        JSON.stringify(e.keys),
        JSON.stringify(e.secondaryKeys),
        JSON.stringify(e.extensions),
      );
      const entryId = Number(res.lastInsertRowid);
      for (const k of e.keys) insKey.run(entryId, k, 0);
      for (const k of e.secondaryKeys) insKey.run(entryId, k, 1);
    });
  }

  // ---------- FTS ----------

  reindexCharacterFts(id: number): void {
    this.db.prepare('DELETE FROM characters_fts WHERE rowid = ?').run(id);
    this.db
      .prepare(
        `INSERT INTO characters_fts (
           rowid, name, creator, tags, description, personality, scenario,
           first_mes, mes_example, alternate_greetings, creator_notes,
           system_prompt, post_history_instructions
         )
         SELECT c.id, c.name, c.creator,
           COALESCE((SELECT group_concat(t.name, ' ')
                     FROM character_tags ct JOIN tags t ON t.id = ct.tag_id
                     WHERE ct.character_id = c.id), ''),
           c.description, c.personality, c.scenario, c.first_mes, c.mes_example,
           COALESCE((SELECT group_concat(g.content, char(10))
                     FROM alternate_greetings g WHERE g.character_id = c.id), ''),
           c.creator_notes, c.system_prompt, c.post_history_instructions
         FROM characters c WHERE c.id = ?`,
      )
      .run(id);
  }

  reindexLorebookFts(id: number): void {
    this.db.prepare('DELETE FROM lorebooks_fts WHERE rowid = ?').run(id);
    this.db
      .prepare(
        `INSERT INTO lorebooks_fts (rowid, name, description, entry_keys, entry_content, entry_comments)
         SELECT lb.id, lb.name, lb.description,
           COALESCE((SELECT group_concat(ek.key, ' ')
                     FROM entry_keys ek JOIN lorebook_entries le ON le.id = ek.entry_id
                     WHERE le.lorebook_id = lb.id), ''),
           COALESCE((SELECT group_concat(le.content, char(10))
                     FROM lorebook_entries le WHERE le.lorebook_id = lb.id), ''),
           COALESCE((SELECT group_concat(le.comment, char(10))
                     FROM lorebook_entries le WHERE le.lorebook_id = lb.id), '')
         FROM lorebooks lb WHERE lb.id = ?`,
      )
      .run(id);
  }

  rebuildFts(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM characters_fts; DELETE FROM lorebooks_fts;');
      const charIds = this.db.prepare('SELECT id FROM characters').all() as { id: number }[];
      for (const { id } of charIds) this.reindexCharacterFts(id);
      const lbIds = this.db.prepare('SELECT id FROM lorebooks').all() as { id: number }[];
      for (const { id } of lbIds) this.reindexLorebookFts(id);
    });
  }

  // ---------- personas ----------
  // User-authored content; instant synchronous writes (no import queue, no FTS).

  insertPersona(p: { name: string; description: string; groupId: number | null }): number {
    const res = this.db
      .prepare(
        'INSERT INTO personas (name, description, group_id) VALUES (@name, @description, @groupId)',
      )
      .run(p);
    return Number(res.lastInsertRowid);
  }

  updatePersona(
    id: number,
    p: { name: string; description: string; groupId: number | null },
  ): boolean {
    const res = this.db
      .prepare(
        `UPDATE personas SET name = @name, description = @description,
           group_id = @groupId, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...p, id });
    return res.changes > 0;
  }

  deletePersona(id: number): boolean {
    return this.db.prepare('DELETE FROM personas WHERE id = ?').run(id).changes > 0;
  }

  setPersonaAvatar(id: number, has: boolean): void {
    this.db
      .prepare(
        "UPDATE personas SET has_avatar = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(has ? 1 : 0, id);
  }

  addPersonaCharacter(personaId: number, characterId: number): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO persona_characters (persona_id, character_id) VALUES (?, ?)',
      )
      .run(personaId, characterId);
    this.db
      .prepare("UPDATE personas SET updated_at = datetime('now') WHERE id = ?")
      .run(personaId);
  }

  removePersonaCharacter(personaId: number, characterId: number): boolean {
    const res = this.db
      .prepare('DELETE FROM persona_characters WHERE persona_id = ? AND character_id = ?')
      .run(personaId, characterId);
    if (res.changes > 0) {
      this.db
        .prepare("UPDATE personas SET updated_at = datetime('now') WHERE id = ?")
        .run(personaId);
    }
    return res.changes > 0;
  }

  replacePersonaCharacters(personaId: number, characterIds: number[]): void {
    this.db.prepare('DELETE FROM persona_characters WHERE persona_id = ?').run(personaId);
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO persona_characters (persona_id, character_id) VALUES (?, ?)',
    );
    for (const cid of characterIds) ins.run(personaId, cid);
    this.db
      .prepare("UPDATE personas SET updated_at = datetime('now') WHERE id = ?")
      .run(personaId);
  }

  insertPersonaGroup(g: { name: string; color: string }): number {
    const res = this.db
      .prepare('INSERT INTO persona_groups (name, color) VALUES (@name, @color)')
      .run(g);
    return Number(res.lastInsertRowid);
  }

  updatePersonaGroup(id: number, g: { name?: string; color?: string }): boolean {
    const res = this.db
      .prepare(
        `UPDATE persona_groups SET
           name = COALESCE(@name, name), color = COALESCE(@color, color)
         WHERE id = @id`,
      )
      .run({ name: g.name ?? null, color: g.color ?? null, id });
    return res.changes > 0;
  }

  deletePersonaGroup(id: number): boolean {
    // Personas in the group survive; FK sets their group_id to NULL.
    return this.db.prepare('DELETE FROM persona_groups WHERE id = ?').run(id).changes > 0;
  }

  // ---------- import bookkeeping ----------

  upsertImportFile(row: {
    path: string;
    kind: 'card' | 'lorebook';
    fileHash: string;
    sourceHash: string | null;
    entityType: 'character' | 'lorebook' | null;
    entityId: number | null;
    status: ImportFileRow['status'];
    error: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO import_files (path, kind, file_hash, source_hash, entity_type, entity_id, status, error)
         VALUES (@path, @kind, @fileHash, @sourceHash, @entityType, @entityId, @status, @error)
         ON CONFLICT(path) DO UPDATE SET
           kind = excluded.kind, file_hash = excluded.file_hash,
           source_hash = excluded.source_hash, entity_type = excluded.entity_type,
           entity_id = excluded.entity_id, status = excluded.status,
           error = excluded.error, last_processed_at = datetime('now')`,
      )
      .run(row);
  }

  markFileDeleted(path: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE import_files SET status = 'deleted', last_processed_at = datetime('now')
         WHERE path = ? AND status != 'deleted'`,
      )
      .run(path);
    return res.changes > 0;
  }

  appendLog(row: {
    path: string;
    kind: 'card' | 'lorebook';
    action: string;
    detail: string | null;
    entityType: 'character' | 'lorebook' | null;
    entityId: number | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO import_log (path, kind, action, detail, entity_type, entity_id)
         VALUES (@path, @kind, @action, @detail, @entityType, @entityId)`,
      )
      .run(row);
  }
}
