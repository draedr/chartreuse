import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
let storage: Storage;
let characterId: number;

const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line

const postJson = (url: string, body: unknown, method = 'POST') =>
  app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-personas-'));
  storage = new Storage(path.join(tmp, 'data'));
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

  const imported = importFile({ repo, storage }, fixturePath('v2_card.png'), 'card');
  expect(imported.outcome).toBe('imported');
  characterId = imported.entityId!;
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('persona groups', () => {
  it('full lifecycle with color validation', async () => {
    expect((await postJson('/api/persona-groups', { name: 'Heroes', color: '#zzzzzz' })).status).toBe(400);
    expect((await postJson('/api/persona-groups', { name: 'Heroes', color: 'red' })).status).toBe(400);
    expect((await postJson('/api/persona-groups', { color: '#ff0000' })).status).toBe(400);

    const created = await postJson('/api/persona-groups', { name: 'Heroes', color: '#D97757' });
    expect(created.status).toBe(201);
    const group = await json(created);
    expect(group.color).toBe('#d97757'); // lowercased

    const list = await json(await app.request('/api/persona-groups'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Heroes', personaCount: 0 });

    const renamed = await postJson(`/api/persona-groups/${group.id}`, { name: 'Villains' }, 'PUT');
    expect(renamed.status).toBe(200);
    expect((await json(renamed)).name).toBe('Villains');

    expect((await postJson('/api/persona-groups/9999', { name: 'x' }, 'PUT')).status).toBe(404);
    expect((await app.request(`/api/persona-groups/${group.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/persona-groups/9999', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('personas CRUD', () => {
  let groupId: number;
  let personaId: number;

  it('creates with group + character links', async () => {
    groupId = (await json(await postJson('/api/persona-groups', { name: 'Mains', color: '#3366aa' }))).id;

    expect((await postJson('/api/personas', { name: '' })).status).toBe(400);
    expect((await postJson('/api/personas', { name: 'X', groupId: 999 })).status).toBe(400);
    expect((await postJson('/api/personas', { name: 'X', characterIds: [999999] })).status).toBe(400);

    const res = await postJson('/api/personas', {
      name: 'Captain Quill',
      description: '# The Captain\nA **bold** sky-sailor with a *mysterious* past.\n\n- brave\n- 100% organic',
      groupId,
      characterIds: [characterId],
    });
    expect(res.status).toBe(201);
    const detail = await json(res);
    personaId = detail.id;
    expect(detail.group).toMatchObject({ name: 'Mains', color: '#3366aa' });
    expect(detail.characters).toHaveLength(1);
    expect(detail.characters[0].name).toBe('Mira the Cartographer');
    expect(detail.characterCount).toBe(1);
  });

  it('lists with q (name + description, LIKE-escaped) and group filter', async () => {
    await postJson('/api/personas', { name: 'Background Bob', description: 'plain filler' });

    const byName = await json(await app.request('/api/personas?q=quill'));
    expect(byName.total).toBe(1);
    const byDescription = await json(await app.request('/api/personas?q=sky-sailor'));
    expect(byDescription.total).toBe(1);
    // literal % must not act as a wildcard
    const literalPercent = await json(await app.request('/api/personas?q=100%25%20organic'));
    expect(literalPercent.total).toBe(1);
    const wildcardAbuse = await json(await app.request('/api/personas?q=%25%25'));
    expect(wildcardAbuse.total).toBe(0);

    const grouped = await json(await app.request(`/api/personas?group_id=${groupId}`));
    expect(grouped.items.map((p: { name: string }) => p.name)).toEqual(['Captain Quill']);
  });

  it('allows duplicate persona names and sorts by name/created/updated', async () => {
    const a = await postJson('/api/personas', { name: 'Twin' });
    const b = await postJson('/api/personas', { name: 'Twin' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const twins = await json(await app.request('/api/personas?q=twin'));
    expect(twins.total).toBe(2);

    const byCreated = await json(await app.request('/api/personas?sort=created_at'));
    const created = byCreated.items.map((p: { createdAt: string }) => p.createdAt);
    expect([...created].sort().reverse()).toEqual(created); // desc by default

    const byName = await json(await app.request('/api/personas?sort=name'));
    const names = byName.items.map((p: { name: string }) => p.name.toLowerCase());
    expect([...names].sort()).toEqual(names);

    expect((await app.request('/api/personas?sort=evil')).status).toBe(400);

    // updated_at sort puts a freshly edited persona first
    const bId = (await json(b)).id;
    await postJson(`/api/personas/${bId}`, { description: 'edited' }, 'PUT');
    const byUpdated = await json(await app.request('/api/personas?sort=updated_at'));
    expect(byUpdated.items[0].id).toBe(bId);

    const aId = (await json(a)).id;
    await app.request(`/api/personas/${aId}`, { method: 'DELETE' });
    await app.request(`/api/personas/${bId}`, { method: 'DELETE' });
  });

  it('partial updates: name only, clear group with null, replace links with []', async () => {
    const renamed = await json(await postJson(`/api/personas/${personaId}`, { name: 'Captain Quillon' }, 'PUT'));
    expect(renamed.name).toBe('Captain Quillon');
    expect(renamed.group).not.toBeNull(); // unchanged
    expect(renamed.characters).toHaveLength(1); // unchanged

    const ungrouped = await json(await postJson(`/api/personas/${personaId}`, { groupId: null }, 'PUT'));
    expect(ungrouped.group).toBeNull();

    const unlinked = await json(await postJson(`/api/personas/${personaId}`, { characterIds: [] }, 'PUT'));
    expect(unlinked.characters).toHaveLength(0);

    // restore for later tests
    await postJson(`/api/personas/${personaId}`, { characterIds: [characterId], groupId }, 'PUT');
    expect((await postJson('/api/personas/99999', { name: 'x' }, 'PUT')).status).toBe(404);
  });

  it('deleting the group keeps the persona, ungrouped', async () => {
    const tempGroup = await json(await postJson('/api/persona-groups', { name: 'Temp', color: '#00ff00' }));
    const p = await json(await postJson('/api/personas', { name: 'Orphan', groupId: tempGroup.id }));
    await app.request(`/api/persona-groups/${tempGroup.id}`, { method: 'DELETE' });
    const after = await json(await app.request(`/api/personas/${p.id}`));
    expect(after.group).toBeNull();
    await app.request(`/api/personas/${p.id}`, { method: 'DELETE' });
  });

  it('lists include a description snippet', async () => {
    const list = await json(await app.request('/api/personas?q=quill'));
    expect(list.items[0].descriptionSnippet).toContain('# The Captain');
    expect(list.items[0].descriptionSnippet.length).toBeLessThanOrEqual(201);
  });

  it('single link/unlink endpoints work and stay persona-owned', async () => {
    const p = await json(await postJson('/api/personas', { name: 'Linker' }));
    // link
    const link = await app.request(`/api/personas/${p.id}/characters/${characterId}`, {
      method: 'POST',
    });
    expect(link.status).toBe(200);
    // idempotent re-link
    expect(
      (await app.request(`/api/personas/${p.id}/characters/${characterId}`, { method: 'POST' }))
        .status,
    ).toBe(200);
    let detail = await json(await app.request(`/api/personas/${p.id}`));
    expect(detail.characters).toHaveLength(1);

    // 404s
    expect(
      (await app.request(`/api/personas/99999/characters/${characterId}`, { method: 'POST' }))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/api/personas/${p.id}/characters/99999`, { method: 'POST' })).status,
    ).toBe(404);

    // unlink
    expect(
      (
        await app.request(`/api/personas/${p.id}/characters/${characterId}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/personas/${p.id}/characters/${characterId}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404); // already unlinked
    detail = await json(await app.request(`/api/personas/${p.id}`));
    expect(detail.characters).toHaveLength(0);
    await app.request(`/api/personas/${p.id}`, { method: 'DELETE' });
  });

  it('character detail lists connected personas with group color', async () => {
    const detail = await json(await app.request(`/api/characters/${characterId}`));
    expect(detail.personas).toHaveLength(1);
    expect(detail.personas[0]).toMatchObject({
      name: 'Captain Quillon',
      group: { name: 'Mains', color: '#3366aa' },
    });
  });

  it('avatar: validates PNG, serves it, supports removal', async () => {
    expect((await app.request(`/api/personas/${personaId}/avatar`)).status).toBe(404);

    const badPut = await app.request(`/api/personas/${personaId}/avatar`, {
      method: 'PUT',
      body: Buffer.from('definitely not a png'),
    });
    expect(badPut.status).toBe(400);

    const png = readFixture('v2_card.png');
    const goodPut = await app.request(`/api/personas/${personaId}/avatar`, {
      method: 'PUT',
      body: new Uint8Array(png),
    });
    expect(goodPut.status).toBe(200);

    const detail = await json(await app.request(`/api/personas/${personaId}`));
    expect(detail.hasAvatar).toBe(true);

    const served = await app.request(`/api/personas/${personaId}/avatar`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);

    expect((await app.request(`/api/personas/${personaId}/avatar`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/personas/${personaId}/avatar`)).status).toBe(404);

    // re-upload for the delete-cleanup test below
    await app.request(`/api/personas/${personaId}/avatar`, { method: 'PUT', body: new Uint8Array(png) });
  });

  it('deleting a character cascades the link from the persona side', async () => {
    // second character to delete safely
    const { Repository } = await import('../src/importer/repository.js');
    void Repository; // (no-op: cascade exercised via API below)
    const before = await json(await app.request(`/api/personas/${personaId}`));
    expect(before.characters).toHaveLength(1);
    await app.request(`/api/characters/${characterId}`, { method: 'DELETE' });
    const after = await json(await app.request(`/api/personas/${personaId}`));
    expect(after.characters).toHaveLength(0);
  });

  it('deleting the persona removes its avatar file', async () => {
    const avatarFile = storage.personaAvatarPath(personaId);
    expect(existsSync(avatarFile)).toBe(true);
    expect((await app.request(`/api/personas/${personaId}`, { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(avatarFile)).toBe(false);
    expect((await app.request(`/api/personas/${personaId}`)).status).toBe(404);
    expect((await app.request(`/api/personas/${personaId}`, { method: 'DELETE' })).status).toBe(404);
  });
});
