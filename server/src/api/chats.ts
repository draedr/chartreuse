import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ChatDetail, ChatSummary } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import { ChatParseError, parseChat } from '../chats/parseChat.js';
import { toChatSummary } from './serialize.js';

const MAX_CHAT_BYTES = 50 * 1024 * 1024;

const renameSchema = z.object({
  originalFilename: z.string().trim().min(1).max(500),
});

function attachmentHeaders(filename: string): Record<string, string> {
  // Header values are Latin-1 (ByteString): the quoted filename must be ASCII,
  // so non-ASCII names (emoji, surrogate pairs) only ride in the UTF-8 filename*.
  // eslint-disable-next-line no-control-regex
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}

/** Chat upload/list/view/download/delete, mounted under /api. */
export function chatsRoutes(ctx: AppContext): Hono {
  const { db, repo, storage } = ctx;
  const app = new Hono();

  const chatRow = (id: number) =>
    db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  app.get('/characters/:id/chats', (c) => {
    const characterId = Number(c.req.param('id'));
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId)) {
      return c.json({ error: 'character not found' }, 404);
    }
    const rows = db
      .prepare('SELECT * FROM chats WHERE character_id = ? ORDER BY created_at DESC, id DESC')
      .all(characterId) as Record<string, unknown>[];
    const body: ChatSummary[] = rows.map(toChatSummary);
    return c.json(body);
  });

  app.post('/characters/:id/chats', async (c) => {
    const characterId = Number(c.req.param('id'));
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId)) {
      return c.json({ error: 'character not found' }, 404);
    }

    let file: unknown;
    try {
      file = (await c.req.parseBody())['file'];
    } catch {
      return c.json({ error: 'expected multipart form-data with a "file" field' }, 400);
    }
    if (!(file instanceof File)) {
      return c.json({ error: 'missing "file" field' }, 400);
    }
    if (file.size > MAX_CHAT_BYTES) {
      return c.json({ error: 'chat file too large (max 50 MB)' }, 413);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = parseChat(bytes.toString('utf8'));
    } catch (err) {
      if (err instanceof ChatParseError) {
        return c.json({ error: `not a valid SillyTavern chat: ${err.message}` }, 400);
      }
      throw err;
    }

    const filename = file.name && file.name.trim() ? file.name : 'chat.jsonl';
    const id = repo.transaction(() =>
      repo.insertChat({
        characterId,
        originalFilename: filename,
        userName: parsed.meta.userName,
        characterName: parsed.meta.characterName,
        createDate: parsed.meta.createDate,
        messageCount: parsed.messages.length,
        fileSize: bytes.length,
      }),
    );
    try {
      storage.storeChat(id, bytes);
    } catch (err) {
      // Roll the row back so the DB never references a file we failed to write.
      repo.transaction(() => repo.deleteChat(id));
      throw err;
    }
    return c.json(toChatSummary(chatRow(id)!), 201);
  });

  app.get('/chats/:chatId', (c) => {
    const id = Number(c.req.param('chatId'));
    const row = chatRow(id);
    if (!row) return c.json({ error: 'not found' }, 404);
    const p = storage.chatPath(id);
    if (!existsSync(p)) return c.json({ error: 'chat file missing from storage' }, 410);
    const parsed = parseChat(readFileSync(p, 'utf8'));
    const body: ChatDetail = { ...toChatSummary(row), messages: parsed.messages };
    return c.json(body);
  });

  app.get('/chats/:chatId/download', (c) => {
    const id = Number(c.req.param('chatId'));
    const row = chatRow(id);
    if (!row) return c.json({ error: 'not found' }, 404);
    const p = storage.chatPath(id);
    if (!existsSync(p)) return c.json({ error: 'chat file missing from storage' }, 410);
    return c.body(
      new Uint8Array(readFileSync(p)),
      200,
      attachmentHeaders((row.original_filename as string) ?? `chat-${id}.jsonl`),
    );
  });

  app.patch('/chats/:chatId', async (c) => {
    const id = Number(c.req.param('chatId'));
    if (!chatRow(id)) return c.json({ error: 'not found' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid name', issues: parsed.error.issues }, 400);
    }
    repo.transaction(() => repo.renameChat(id, parsed.data.originalFilename));
    return c.json(toChatSummary(chatRow(id)!));
  });

  app.delete('/chats/:chatId', (c) => {
    const id = Number(c.req.param('chatId'));
    const deleted = repo.transaction(() => repo.deleteChat(id));
    if (!deleted) return c.json({ error: 'not found' }, 404);
    storage.removeChat(id);
    return c.json({ ok: true });
  });

  return app;
}
