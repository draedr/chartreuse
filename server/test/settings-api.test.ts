import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { applyStoredSettings, loadEnvConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { Storage } from '../src/files/storage.js';
import { Repository } from '../src/importer/repository.js';
import type { AppContext } from '../src/context.js';

let tmp: string;
let db: Db;
let app: Hono;

const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line

const putSettings = (body: unknown) =>
  app.request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-settings-'));
  const storage = new Storage(path.join(tmp, 'data'));
  db = openDb(storage.dbPath);
  migrate(db);
  const config = applyStoredSettings(db, { ...loadEnvConfig({}), dataDir: storage.dataDir });
  app = buildApp({ db, storage, repo: new Repository(db), config });
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('renderHtml setting', () => {
  it('defaults to false', async () => {
    expect((await json(await app.request('/api/settings'))).renderHtml).toBe(false);
  });

  it('toggles via PUT and survives a fresh applyStoredSettings()', async () => {
    expect((await json(await putSettings({ renderHtml: true }))).renderHtml).toBe(true);
    expect((await json(await app.request('/api/settings'))).renderHtml).toBe(true);

    // Re-derive config from the persisted settings table (simulates a reboot).
    const reloaded = applyStoredSettings(db, { ...loadEnvConfig({}), dataDir: tmp });
    expect(reloaded.renderHtml).toBe(true);
  });

  it('rejects a non-boolean value', async () => {
    expect((await putSettings({ renderHtml: 'yes' })).status).toBe(400);
  });
});
