import { Hono } from 'hono';
import { z } from 'zod';
import type { Paginated, CharacterSummary } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import { characterMatchQuery, characterRankExpr } from '../search/ftsQuery.js';
import { toCharacterDetail, toCharacterSummary } from './serialize.js';

const listQuerySchema = z.object({
  q: z.string().optional(),
  fields: z.string().optional(),
  tags: z.string().optional(),
  exclude_tags: z.string().optional(),
  tags_mode: z.enum(['all', 'any']).default('all'),
  creator: z.string().optional(),
  has_lorebook: z.enum(['true', 'false']).optional(),
  spec: z.enum(['chara_card_v2', 'chara_card_v3']).optional(),
  min_length: z.coerce.number().int().min(0).optional(),
  max_length: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['name', 'created_at', 'updated_at', 'text_length', 'relevance']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

const csv = (s: string | undefined): string[] =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function charactersRoutes(ctx: AppContext): Hono {
  const { db } = ctx;
  const app = new Hono();

  app.get('/', (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const tags = csv(p.tags);
    const match = p.q ? characterMatchQuery(p.q, csv(p.fields)) : null;

    const filters: string[] = [];
    const args: unknown[] = [];
    if (match) {
      filters.push('characters_fts MATCH ?');
      args.push(match);
    }
    if (tags.length > 0) {
      if (p.tags_mode === 'any') {
        filters.push(
          `c.id IN (SELECT ct.character_id FROM character_tags ct
                    JOIN tags t ON t.id = ct.tag_id
                    WHERE t.name IN (${tags.map(() => '?').join(', ')}))`,
        );
        args.push(...tags);
      } else {
        filters.push(
          `c.id IN (SELECT ct.character_id FROM character_tags ct
                    JOIN tags t ON t.id = ct.tag_id
                    WHERE t.name IN (${tags.map(() => '?').join(', ')})
                    GROUP BY ct.character_id
                    HAVING COUNT(DISTINCT t.id) = ?)`,
        );
        args.push(...tags, tags.length);
      }
    }
    const excludeTags = csv(p.exclude_tags);
    if (excludeTags.length > 0) {
      filters.push(
        `c.id NOT IN (SELECT ct.character_id FROM character_tags ct
                      JOIN tags t ON t.id = ct.tag_id
                      WHERE t.name IN (${excludeTags.map(() => '?').join(', ')}))`,
      );
      args.push(...excludeTags);
    }
    if (p.min_length !== undefined) {
      filters.push('c.text_length >= ?');
      args.push(p.min_length);
    }
    if (p.max_length !== undefined) {
      filters.push('c.text_length <= ?');
      args.push(p.max_length);
    }
    if (p.creator) {
      filters.push('c.creator = ? COLLATE NOCASE');
      args.push(p.creator);
    }
    if (p.spec) {
      filters.push('c.spec = ?');
      args.push(p.spec);
    }
    if (p.has_lorebook) {
      filters.push(
        `${p.has_lorebook === 'true' ? '' : 'NOT '}EXISTS (SELECT 1 FROM lorebooks lb WHERE lb.character_id = c.id)`,
      );
    }

    const from = match
      ? 'FROM characters_fts JOIN characters c ON c.id = characters_fts.rowid'
      : 'FROM characters c';
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const sortKey = p.sort ?? (match ? 'relevance' : 'updated_at');
    const order = p.order ?? (sortKey === 'name' ? 'asc' : sortKey === 'relevance' ? 'asc' : 'desc');
    const orderBy =
      sortKey === 'relevance' && match
        ? `${characterRankExpr()} ${order}`
        : sortKey === 'created_at' || sortKey === 'updated_at' || sortKey === 'text_length'
          ? `c.${sortKey} ${order}, c.id ${order}`
          : `c.name COLLATE NOCASE ${order}, c.id asc`;

    const select = match
      ? `SELECT c.id, c.name, c.creator, c.spec, c.has_avatar, c.created_at, c.updated_at,
           c.text_length,
           EXISTS (SELECT 1 FROM lorebooks lb WHERE lb.character_id = c.id) AS has_lorebook,
           snippet(characters_fts, -1, char(1), char(2), '…', 18) AS snip`
      : `SELECT c.id, c.name, c.creator, c.spec, c.has_avatar, c.created_at, c.updated_at,
           c.text_length,
           EXISTS (SELECT 1 FROM lorebooks lb WHERE lb.character_id = c.id) AS has_lorebook`;

    const total = (
      db.prepare(`SELECT COUNT(*) AS n ${from} ${where}`).get(...args) as { n: number }
    ).n;
    const rows = db
      .prepare(`${select} ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...args, p.limit, (p.page - 1) * p.limit) as Record<string, unknown>[];

    const tagsByCharacter = fetchTags(ctx, rows.map((r) => r.id as number));
    const body: Paginated<CharacterSummary> = {
      items: rows.map((r) => toCharacterSummary(r, tagsByCharacter.get(r.id as number) ?? [])),
      total,
      page: p.page,
      limit: p.limit,
    };
    return c.json(body);
  });

  app.get('/:id', (c) => {
    const id = Number(c.req.param('id'));
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);

    const tags = (
      db
        .prepare(
          `SELECT t.name FROM character_tags ct JOIN tags t ON t.id = ct.tag_id
           WHERE ct.character_id = ? ORDER BY t.name COLLATE NOCASE`,
        )
        .all(id) as { name: string }[]
    ).map((t) => t.name);
    const greetings = (
      db
        .prepare(
          'SELECT content FROM alternate_greetings WHERE character_id = ? ORDER BY position',
        )
        .all(id) as { content: string }[]
    ).map((g) => g.content);
    const lorebooks = db
      .prepare(
        `SELECT lb.id, lb.name, lb.origin,
           (SELECT COUNT(*) FROM lorebook_entries le WHERE le.lorebook_id = lb.id) AS entry_count
         FROM lorebooks lb WHERE lb.character_id = ? ORDER BY lb.id`,
      )
      .all(id) as { id: number; name: string; origin: 'embedded' | 'standalone'; entry_count: number }[];
    const personas = db
      .prepare(
        `SELECT p.id, p.name, p.has_avatar, g.name AS group_name, g.color AS group_color
         FROM persona_characters pc
         JOIN personas p ON p.id = pc.persona_id
         LEFT JOIN persona_groups g ON g.id = p.group_id
         WHERE pc.character_id = ? ORDER BY p.name COLLATE NOCASE`,
      )
      .all(id) as Record<string, unknown>[];

    return c.json(toCharacterDetail(row, tags, greetings, lorebooks, personas));
  });

  /** The card's original payload, for in-app inspection (export downloads the file). */
  app.get('/:id/raw', (c) => {
    const row = db
      .prepare('SELECT raw_json FROM characters WHERE id = ?')
      .get(Number(c.req.param('id'))) as { raw_json: string } | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.body(row.raw_json, 200, { 'Content-Type': 'application/json' });
  });

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'));
    // Capture chat ids before the row cascade so we can drop their files too.
    const chatIds = (
      db.prepare('SELECT id FROM chats WHERE character_id = ?').all(id) as { id: number }[]
    ).map((r) => r.id);
    const deleted = ctx.repo.transaction(() => ctx.repo.deleteCharacter(id));
    if (!deleted) return c.json({ error: 'not found' }, 404);
    ctx.storage.removeAvatar(id);
    for (const chatId of chatIds) ctx.storage.removeChat(chatId);
    return c.json({ ok: true });
  });

  return app;
}

function fetchTags(ctx: AppContext, ids: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (ids.length === 0) return map;
  const rows = ctx.db
    .prepare(
      `SELECT ct.character_id, t.name FROM character_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.character_id IN (${ids.map(() => '?').join(', ')})
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(...ids) as { character_id: number; name: string }[];
  for (const r of rows) {
    const list = map.get(r.character_id);
    if (list) list.push(r.name);
    else map.set(r.character_id, [r.name]);
  }
  return map;
}
