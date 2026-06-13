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
import { fixturePath } from './helpers.js';

let tmp: string;
let db: Db;
let app: Hono;
let storage: Storage;
let characterId: number;

const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line

const SAMPLE = [
  JSON.stringify({ user_name: 'Jackson', character_name: 'Narrator', create_date: 'd0', chat_metadata: {} }),
  JSON.stringify({ name: 'Narrator', is_user: false, mes: 'intro' }),
  JSON.stringify({
    name: 'Narrator',
    is_user: false,
    mes: 'b',
    swipe_id: 1,
    swipes: ['a', 'b'],
    extra: { model: 'glm-4.6' },
  }),
  JSON.stringify({ name: 'Jackson', is_user: true, mes: 'reply' }),
].join('\n');

const uploadChat = (id: number, content: string, filename = 'chat.jsonl') => {
  const form = new FormData();
  form.append('file', new File([content], filename, { type: 'application/jsonl' }));
  return app.request(`/api/characters/${id}/chats`, { method: 'POST', body: form });
};

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'chartreuse-chats-'));
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

describe('chats API', () => {
  it('upload → list → view → download → delete lifecycle', async () => {
    const created = await uploadChat(characterId, SAMPLE, 'session.jsonl');
    expect(created.status).toBe(201);
    const summary = await json(created);
    expect(summary).toMatchObject({
      characterId,
      originalFilename: 'session.jsonl',
      userName: 'Jackson',
      messageCount: 3,
    });
    expect(existsSync(storage.chatPath(summary.id))).toBe(true);

    const list = await json(await app.request(`/api/characters/${characterId}/chats`));
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(summary.id);

    const detail = await json(await app.request(`/api/chats/${summary.id}`));
    expect(detail.messages).toHaveLength(3);
    // Swipeable assistant message keeps its active index and model.
    expect(detail.messages[1]).toMatchObject({ swipeId: 1, model: 'glm-4.6' });
    expect(detail.messages[1].swipes).toHaveLength(2);

    const download = await app.request(`/api/chats/${summary.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('session.jsonl');
    expect(await download.text()).toBe(SAMPLE); // byte-identical round-trip

    const del = await app.request(`/api/chats/${summary.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(existsSync(storage.chatPath(summary.id))).toBe(false);
    expect(await json(await app.request(`/api/characters/${characterId}/chats`))).toHaveLength(0);
  });

  it('renames a chat (and the download uses the new name)', async () => {
    const created = await json(await uploadChat(characterId, SAMPLE, 'old.jsonl'));

    const renamed = await app.request(`/api/chats/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalFilename: 'renamed.jsonl' }),
    });
    expect(renamed.status).toBe(200);
    expect((await json(renamed)).originalFilename).toBe('renamed.jsonl');

    const download = await app.request(`/api/chats/${created.id}/download`);
    expect(download.headers.get('content-disposition')).toContain('renamed.jsonl');

    // Empty names are rejected; unknown ids 404.
    expect(
      (
        await app.request(`/api/chats/${created.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalFilename: '  ' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/chats/999999', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalFilename: 'x.jsonl' }),
        })
      ).status,
    ).toBe(404);

    await app.request(`/api/chats/${created.id}`, { method: 'DELETE' });
  });

  it('rejects an invalid chat file', async () => {
    const res = await uploadChat(characterId, 'not jsonl');
    expect(res.status).toBe(400);
  });

  it('404s for an unknown character', async () => {
    expect((await uploadChat(999999, SAMPLE)).status).toBe(404);
    expect((await app.request('/api/characters/999999/chats')).status).toBe(404);
  });

  it('404s for an unknown chat id', async () => {
    expect((await app.request('/api/chats/999999')).status).toBe(404);
  });

  it('cascades when the parent character is deleted', async () => {
    const card2 = importFile(
      { repo: new Repository(db), storage },
      fixturePath('v2_card.png'),
      'card',
    );
    // Same fixture is a duplicate; reuse the existing character id instead.
    const cid = card2.entityId ?? characterId;
    const created = await json(await uploadChat(cid, SAMPLE));
    expect(existsSync(storage.chatPath(created.id))).toBe(true);

    const del = await app.request(`/api/characters/${cid}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    // Row is gone via FK cascade; the API no longer serves it...
    expect((await app.request(`/api/chats/${created.id}`)).status).toBe(404);
    // ...and the stored .jsonl is cleaned up rather than orphaned.
    expect(existsSync(storage.chatPath(created.id))).toBe(false);
  });
});
