import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { loadEnvConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { Storage } from '../src/files/storage.js';
import { importUploadedCard } from '../src/importer/importFile.js';
import { ImportQueue } from '../src/importer/queue.js';
import { Repository } from '../src/importer/repository.js';
import type { AppContext } from '../src/context.js';
import { readFixture } from './helpers.js';

let tmp: string;
let db: Db;
let app: Hono;
let cardsDir: string;

const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line

const card = (name: string, extra = '') =>
  `{"spec":"chara_card_v2","spec_version":"2.0","data":{"name":"${name}","description":"x"}}${extra}`;

const upload = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return app.request('/api/imports/upload', { method: 'POST', body: form });
};

const characterCount = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-upload-'));
  const storage = new Storage(path.join(tmp, 'data'));
  cardsDir = path.join(tmp, 'watch', 'cards');
  db = openDb(storage.dbPath);
  migrate(db);
  const repo = new Repository(db);
  const queue = new ImportQueue();
  const ctx: AppContext = {
    db,
    storage,
    repo,
    config: { ...loadEnvConfig({}), dataDir: storage.dataDir, watchCardsDir: cardsDir },
    importUploadedCard: (filename, bytes) =>
      queue.enqueue(() => importUploadedCard({ repo, storage }, cardsDir, filename, bytes)),
  };
  app = buildApp(ctx);
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('POST /api/imports/upload', () => {
  it('imports a new card and saves it into the watched folder', async () => {
    const res = await upload(new File([card('Alpha')], 'alpha.json'));
    expect(res.status).toBe(200);
    const [r] = (await json(res)).results;
    expect(r).toMatchObject({ filename: 'alpha.json', outcome: 'imported' });
    expect(typeof r.characterId).toBe('number');
    expect(existsSync(path.join(cardsDir, 'alpha.json'))).toBe(true);
    expect(characterCount()).toBe(1);
  });

  it('skips a byte-identical re-upload as a duplicate', async () => {
    const before = characterCount();
    const r = (await json(await upload(new File([card('Alpha')], 'alpha.json')))).results[0];
    expect(r.outcome).toBe('duplicate');
    expect(characterCount()).toBe(before); // no new card
    // No second file written (the original is reused, suffix not needed).
    expect(readdirSync(cardsDir).filter((f) => f.startsWith('alpha'))).toHaveLength(1);
  });

  it('imports a different file with the same card as a SEPARATE card', async () => {
    const before = characterCount();
    // Same parsed payload, different bytes (trailing whitespace) → new file hash.
    const r = (await json(await upload(new File([card('Alpha', '\n')], 'alpha.json')))).results[0];
    expect(r.outcome).toBe('imported');
    expect(characterCount()).toBe(before + 1);
    // Collision-safe filename in the watch folder.
    expect(existsSync(path.join(cardsDir, 'alpha (1).json'))).toBe(true);
  });

  it('imports a PNG card (and the avatar is stored)', async () => {
    const r = (await json(await upload(new File([readFixture('v2_card.png')], 'hero.png')))).results[0];
    expect(r.outcome).toBe('imported');
    expect(existsSync(path.join(cardsDir, 'hero.png'))).toBe(true);
  });

  it('rejects a non-card file without writing it', async () => {
    const r = (await json(await upload(new File(['not a card'], 'junk.json')))).results[0];
    expect(r.outcome).toBe('error');
    expect(existsSync(path.join(cardsDir, 'junk.json'))).toBe(false);
  });

  it('rejects unsupported extensions', async () => {
    const r = (await json(await upload(new File(['x'], 'notes.txt')))).results[0];
    expect(r.outcome).toBe('error');
  });

  it('processes multiple files in one request', async () => {
    const form = new FormData();
    form.append('file', new File([card('Multi1')], 'm1.json'));
    form.append('file', new File([card('Multi2')], 'm2.json'));
    const { results } = await json(await app.request('/api/imports/upload', { method: 'POST', body: form }));
    expect(results).toHaveLength(2);
    expect(results.every((r: any) => r.outcome === 'imported')).toBe(true); // eslint-disable-line
  });

  it('400s when no files are provided', async () => {
    const res = await app.request('/api/imports/upload', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });
});
