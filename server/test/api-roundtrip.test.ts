import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { loadEnvConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { Storage } from '../src/files/storage.js';
import { importFile } from '../src/importer/importFile.js';
import { Repository } from '../src/importer/repository.js';
import type { AppContext } from '../src/context.js';
import { fixturePath, readFixture } from './helpers.js';

let tmp: string;
let db: Db;
let app: Hono;

const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-api-'));
  const storage = new Storage(path.join(tmp, 'data'));
  db = openDb(storage.dbPath);
  migrate(db);
  const repo = new Repository(db);
  const ctx: AppContext = {
    db,
    storage,
    repo,
    config: { ...loadEnvConfig({}), dataDir: storage.dataDir },
  };
  app = buildApp(ctx);

  const deps = { repo, storage };
  expect(importFile(deps, fixturePath('v2_card.png'), 'card').outcome).toBe('imported');
  expect(importFile(deps, fixturePath('v1_bare.json'), 'card').outcome).toBe('imported');
  expect(importFile(deps, fixturePath('worldinfo_standalone.json'), 'lorebook').outcome).toBe(
    'imported',
  );
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('characters API', () => {
  it('lists with tags filter (AND semantics)', async () => {
    const both = await json(await app.request('/api/characters?tags=Fantasy,Adventure'));
    expect(both.total).toBe(1);
    expect(both.items[0].name).toBe('Mira the Cartographer');
    const none = await json(await app.request('/api/characters?tags=Fantasy,Nonexistent'));
    expect(none.total).toBe(0);
  });

  it('searches every indexed field', async () => {
    const cases: [string, string][] = [
      ['Mira', 'name'],
      ['fixturesmith', 'creator'],
      ['adventure', 'tags'],
      ['mapmaker', 'description'],
      ['homesick', 'personality'],
      ['observatory', 'scenario'],
      ['Skyharbor', 'first_mes'],
      ['exploration', 'creator_notes'],
      ['cartographer stay', 'system_prompt'], // "cartographer" also in name
      ['tripod', 'alternate_greetings'],
    ];
    for (const [term] of cases) {
      const res = await json(await app.request(`/api/characters?q=${encodeURIComponent(term)}`));
      expect(res.total, `term: ${term}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects field scoping', async () => {
    const scoped = await json(await app.request('/api/characters?q=mapmaker&fields=first_mes'));
    expect(scoped.total).toBe(0);
    const right = await json(await app.request('/api/characters?q=mapmaker&fields=description'));
    expect(right.total).toBe(1);
  });

  it('supports any/all tag modes and tag exclusion', async () => {
    // Mira: Fantasy, Adventure, OC — Plain Pete: no tags
    const anyMode = await json(
      await app.request('/api/characters?tags=Fantasy,Nonexistent&tags_mode=any'),
    );
    expect(anyMode.total).toBe(1);
    const allMode = await json(
      await app.request('/api/characters?tags=Fantasy,Nonexistent&tags_mode=all'),
    );
    expect(allMode.total).toBe(0);

    const excluded = await json(await app.request('/api/characters?exclude_tags=Fantasy'));
    expect(excluded.items.map((i: { name: string }) => i.name)).toEqual(['Plain Pete']);
    const both = await json(
      await app.request('/api/characters?tags=Adventure&exclude_tags=Fantasy'),
    );
    expect(both.total).toBe(0);
  });

  it('filters and sorts by text length', async () => {
    const all = await json(await app.request('/api/characters?sort=text_length&order=desc'));
    const lengths = all.items.map((i: { textLength: number }) => i.textLength);
    expect(lengths.every((n: number) => typeof n === 'number' && n > 0)).toBe(true);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);

    const longest = Math.max(...lengths);
    const onlyLong = await json(
      await app.request(`/api/characters?min_length=${longest}`),
    );
    expect(onlyLong.total).toBe(1);
    const onlyShort = await json(
      await app.request(`/api/characters?max_length=${longest - 1}`),
    );
    expect(onlyShort.total).toBe(all.total - 1);
    expect((await app.request('/api/characters?min_length=banana')).status).toBe(400);
  });

  it('has_lorebook filter works', async () => {
    const withBook = await json(await app.request('/api/characters?has_lorebook=true'));
    expect(withBook.items.map((i: { name: string }) => i.name)).toEqual([
      'Mira the Cartographer',
    ]);
    const without = await json(await app.request('/api/characters?has_lorebook=false'));
    expect(without.items.map((i: { name: string }) => i.name)).toEqual(['Plain Pete']);
  });

  it('detail includes greetings, tags and linked lorebook', async () => {
    const list = await json(await app.request('/api/characters?q=Mira'));
    const detail = await json(await app.request(`/api/characters/${list.items[0].id}`));
    expect(detail.alternateGreetings).toHaveLength(2);
    expect(detail.tags).toContain('Fantasy');
    expect(detail.lorebooks).toHaveLength(1);
    expect(detail.lorebooks[0].name).toBe('Eldoria Atlas');
  });

  it('serves the raw card payload inline', async () => {
    const list = await json(await app.request('/api/characters?q=Mira'));
    const res = await app.request(`/api/characters/${list.items[0].id}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const raw = await json(res);
    expect(raw.spec).toBe('chara_card_v2');
    expect(raw.data.name).toBe('Mira the Cartographer');
    expect((await app.request('/api/characters/999999/raw')).status).toBe(404);
  });

  it('export is byte-identical to the original file', async () => {
    const list = await json(await app.request('/api/characters?q=Mira'));
    const res = await app.request(`/api/characters/${list.items[0].id}/export`);
    expect(res.status).toBe(200);
    const exported = Buffer.from(await res.arrayBuffer());
    expect(exported.equals(readFixture('v2_card.png'))).toBe(true);
  });

  it('garbage queries are 200 (browse mode) and bad params are 400', async () => {
    expect((await app.request('/api/characters?q=%2A%28%29%5E')).status).toBe(200);
    expect((await app.request('/api/characters?page=0')).status).toBe(400);
    expect((await app.request('/api/characters?sort=evil')).status).toBe(400);
  });
});

describe('lorebooks API', () => {
  it('filters by origin and exact entry key', async () => {
    const standalone = await json(await app.request('/api/lorebooks?origin=standalone'));
    expect(standalone.items.map((i: { name: string }) => i.name)).toEqual(['Astraea Codex']);
    const byKey = await json(await app.request('/api/lorebooks?key=Battle%20Song'));
    expect(byKey.total).toBe(1);
    expect(byKey.items[0].name).toBe('Astraea Codex');
  });

  it('embedded book export converts to world-info format', async () => {
    const embedded = await json(await app.request('/api/lorebooks?origin=embedded'));
    const res = await app.request(`/api/lorebooks/${embedded.items[0].id}/export`);
    const doc = await json(res);
    expect(doc.name).toBe('Eldoria Atlas');
    expect(doc.entries['0'].key).toEqual(['Eldoria', 'floating isles']);
    expect(doc.entries['0'].disable).toBe(false);
    expect(doc.entries['0'].position).toBe(0); // before_char
  });

  it('standalone export is byte-identical, embedded delete is 409', async () => {
    const standalone = await json(await app.request('/api/lorebooks?origin=standalone'));
    const res = await app.request(`/api/lorebooks/${standalone.items[0].id}/export`);
    const exported = Buffer.from(await res.arrayBuffer());
    expect(exported.equals(readFixture('worldinfo_standalone.json'))).toBe(true);

    const embedded = await json(await app.request('/api/lorebooks?origin=embedded'));
    const del = await app.request(`/api/lorebooks/${embedded.items[0].id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(409);
  });
});

describe('imports API', () => {
  it('filters the log by kind', async () => {
    const all = await json(await app.request('/api/imports'));
    const cards = await json(await app.request('/api/imports?kind=card'));
    const lorebooks = await json(await app.request('/api/imports?kind=lorebook'));
    expect(cards.total + lorebooks.total).toBe(all.total);
    expect(cards.items.every((i: { kind: string }) => i.kind === 'card')).toBe(true);
    expect(lorebooks.items.every((i: { kind: string }) => i.kind === 'lorebook')).toBe(true);
    expect(cards.total).toBeGreaterThanOrEqual(2);
    expect(lorebooks.total).toBeGreaterThanOrEqual(1);
  });

  it('quarantine accepts a kind filter and rejects bad kinds', async () => {
    expect((await app.request('/api/imports/quarantine?kind=card')).status).toBe(200);
    expect((await app.request('/api/imports/quarantine?kind=banana')).status).toBe(400);
    expect((await app.request('/api/imports?kind=banana')).status).toBe(400);
  });

  it('status returns idle per-kind progress when no watcher is wired', async () => {
    const res = await json(await app.request('/api/imports/status'));
    expect(res.card).toEqual({ active: false, total: 0, processed: 0, watching: false });
    expect(res.lorebook).toEqual({ active: false, total: 0, processed: 0, watching: false });
  });
});

describe('lorebook fulltext search', () => {
  it('matches entry content with snippets', async () => {
    const res = await json(await app.request('/api/lorebooks?q=windstone'));
    expect(res.total).toBe(1);
    expect(res.items[0].snippet).toContain('windstone');
    const chars = await json(await app.request('/api/characters?q=windstone'));
    expect(chars.total).toBe(0); // lorebook content is not indexed on characters
  });

  it('disabled-entry inversion is queryable (disable:true entry indexed too)', async () => {
    const res = await json(await app.request('/api/lorebooks?q=dampens'));
    expect(res.total).toBe(1);
  });
});

describe('FTS consistency after delete', () => {
  it('deleting a character removes it and its embedded book from search', async () => {
    const list = await json(await app.request('/api/characters?q=Mira'));
    const id = list.items[0].id;
    expect((await app.request(`/api/characters/${id}`, { method: 'DELETE' })).status).toBe(200);
    const after = await json(await app.request('/api/characters?q=Mira'));
    expect(after.total).toBe(0);
    const lb = await json(await app.request('/api/lorebooks?q=windstone'));
    expect(lb.total).toBe(0);
  });
});
