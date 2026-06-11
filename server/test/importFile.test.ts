import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { Storage } from '../src/files/storage.js';
import { importFile, markFileRemoved } from '../src/importer/importFile.js';
import { Repository } from '../src/importer/repository.js';
import { fixturePath, readFixture } from './helpers.js';

let tmp: string;
let db: Db;
let repo: Repository;
let storage: Storage;
let deps: { repo: Repository; storage: Storage };

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-test-'));
  storage = new Storage(path.join(tmp, 'data'));
  db = openDb(storage.dbPath);
  migrate(db);
  repo = new Repository(db);
  deps = { repo, storage };
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('importFile (cards)', () => {
  it('imports a v2 PNG card with embedded lorebook', () => {
    const res = importFile(deps, fixturePath('v2_card.png'), 'card');
    expect(res.outcome).toBe('imported');

    const char = db
      .prepare('SELECT * FROM characters WHERE id = ?')
      .get(res.entityId) as Record<string, unknown>;
    expect(char.name).toBe('Mira the Cartographer');
    expect(char.has_avatar).toBe(1);
    expect(char.original_ext).toBe('png');

    const lb = db
      .prepare('SELECT * FROM lorebooks WHERE character_id = ?')
      .get(res.entityId) as Record<string, unknown>;
    expect(lb.origin).toBe('embedded');
    expect(lb.name).toBe('Eldoria Atlas');

    const entries = db
      .prepare('SELECT * FROM lorebook_entries WHERE lorebook_id = ? ORDER BY position_idx')
      .all(lb.id) as Record<string, unknown>[];
    expect(entries).toHaveLength(2);

    const keys = db
      .prepare(
        `SELECT key FROM entry_keys ek JOIN lorebook_entries le ON le.id = ek.entry_id
         WHERE le.lorebook_id = ? AND ek.secondary = 0 ORDER BY key`,
      )
      .all(lb.id) as { key: string }[];
    // ORDER BY key uses the column's NOCASE collation
    expect(keys.map((k) => k.key)).toEqual(['Eldoria', 'floating isles', 'Skyharbor']);

    // FTS: searchable in description and in greeting content
    const hit = db
      .prepare("SELECT rowid FROM characters_fts WHERE characters_fts MATCH 'Eldoria'")
      .get() as { rowid: number };
    expect(hit.rowid).toBe(res.entityId);
    const greetHit = db
      .prepare(
        "SELECT rowid FROM characters_fts WHERE characters_fts MATCH 'alternate_greetings:tripod'",
      )
      .get() as { rowid: number } | undefined;
    expect(greetHit?.rowid).toBe(res.entityId);

    // lorebook FTS too
    const lbHit = db
      .prepare("SELECT rowid FROM lorebooks_fts WHERE lorebooks_fts MATCH 'windstone'")
      .get() as { rowid: number } | undefined;
    expect(lbHit?.rowid).toBe(lb.id);
  });

  it('skips an unchanged file on re-import', () => {
    expect(importFile(deps, fixturePath('v2_card.png'), 'card').outcome).toBe('skipped');
  });

  it('marks the same payload from a different file as duplicate', () => {
    // v2_card.json carries the identical payload (different bytes/formatting)
    const res = importFile(deps, fixturePath('v2_card.json'), 'card');
    expect(res.outcome).toBe('duplicate');
    expect(db.prepare('SELECT COUNT(*) n FROM characters').get()).toMatchObject({ n: 1 });
  });

  it('updates in place when a watched file is edited', () => {
    const p = path.join(tmp, 'editable_card.json');
    const card = JSON.parse(readFixture('v2_card.json').toString('utf8'));
    card.data.name = 'Mira, Revised';
    card.data.description = 'Now charting the sunken isles of Pelagia.';
    card.data.tags = ['Fantasy', 'Nautical'];
    writeFileSync(p, JSON.stringify(card));
    const first = importFile(deps, p, 'card');
    expect(first.outcome).toBe('imported');

    card.data.description = 'Now charting the obsidian trenches of Vhol.';
    writeFileSync(p, JSON.stringify(card));
    const second = importFile(deps, p, 'card');
    expect(second.outcome).toBe('updated');
    expect(second.entityId).toBe(first.entityId);

    // FTS reflects the update: old term gone, new term found
    expect(
      db.prepare("SELECT rowid FROM characters_fts WHERE characters_fts MATCH 'Pelagia'").get(),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT rowid FROM characters_fts WHERE characters_fts MATCH 'Vhol'").get(),
    ).toMatchObject({ rowid: first.entityId });
  });

  it('quarantines malformed files without throwing', () => {
    for (const f of ['not_a_png.png', 'bad_base64.png', 'no_chara_chunk.png'] as const) {
      const res = importFile(deps, fixturePath('malformed', f), 'card');
      expect(res.outcome, f).toBe('quarantined');
    }
    const res = importFile(deps, fixturePath('malformed', 'broken.json'), 'card');
    expect(res.outcome).toBe('quarantined');
    expect(res.error).toBeTruthy();

    const quarantined = readdirSync(storage.quarantineDir);
    expect(quarantined.length).toBeGreaterThanOrEqual(4);

    const logged = db
      .prepare("SELECT COUNT(*) n FROM import_log WHERE action = 'quarantined'")
      .get() as { n: number };
    expect(logged.n).toBeGreaterThanOrEqual(4);
  });

  it('retries young files instead of quarantining when grace is set', () => {
    const p = path.join(tmp, 'half_copied.json');
    writeFileSync(p, '{ "name": "Trunca'); // freshly written → mtime is now
    const res = importFile(deps, p, 'card', { youngFileGraceMs: 60_000 });
    expect(res.outcome).toBe('retry');
  });

  it('stores originals content-addressed and retrievable', () => {
    const row = db
      .prepare("SELECT file_hash FROM import_files WHERE path = ?")
      .get(fixturePath('v2_card.png')) as { file_hash: string };
    const original = readFixture('v2_card.png');
    const stored = readFileSync(storage.originalPath(row.file_hash, 'png'));
    expect(stored.equals(original)).toBe(true);
  });
});

describe('importFile (lorebooks)', () => {
  it('imports standalone world-info', () => {
    const res = importFile(deps, fixturePath('worldinfo_standalone.json'), 'lorebook');
    expect(res.outcome).toBe('imported');
    const lb = db
      .prepare('SELECT * FROM lorebooks WHERE id = ?')
      .get(res.entityId) as Record<string, unknown>;
    expect(lb.origin).toBe('standalone');
    expect(lb.character_id).toBeNull();
    expect(lb.name).toBe('Astraea Codex');

    const hit = db
      .prepare("SELECT rowid FROM lorebooks_fts WHERE lorebooks_fts MATCH 'tyrannical'")
      .get() as { rowid: number } | undefined;
    expect(hit?.rowid).toBe(res.entityId);
  });

  it('imports a character_book-format standalone file', () => {
    const res = importFile(deps, fixturePath('charbook_standalone.json'), 'lorebook');
    expect(res.outcome).toBe('imported');
  });

  it('quarantines a lorebook without entries', () => {
    const res = importFile(deps, fixturePath('malformed', 'wrong_schema.json'), 'lorebook');
    expect(res.outcome).toBe('quarantined');
  });
});

describe('deletion semantics', () => {
  it('keeps the entity when the watched file is removed', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM characters').get() as { n: number };
    markFileRemoved(repo, fixturePath('v2_card.png'), 'card');
    const after = db.prepare('SELECT COUNT(*) n FROM characters').get() as { n: number };
    expect(after.n).toBe(before.n);
    const fileRow = db
      .prepare('SELECT status FROM import_files WHERE path = ?')
      .get(fixturePath('v2_card.png')) as { status: string };
    expect(fileRow.status).toBe('deleted');
  });

  it('cascades embedded lorebooks and FTS rows on character delete', () => {
    const charId = (
      db.prepare("SELECT id FROM characters WHERE name LIKE 'Mira the%'").get() as { id: number }
    ).id;
    const lbId = (
      db.prepare('SELECT id FROM lorebooks WHERE character_id = ?').get(charId) as { id: number }
    ).id;
    repo.deleteCharacter(charId);
    expect(db.prepare('SELECT id FROM lorebooks WHERE id = ?').get(lbId)).toBeUndefined();
    expect(
      db.prepare('SELECT rowid FROM characters_fts WHERE rowid = ?').get(charId),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT rowid FROM lorebooks_fts WHERE rowid = ?').get(lbId),
    ).toBeUndefined();
  });
});
