import { Hono } from 'hono';
import { z } from 'zod';
import type { Paginated, LorebookSummary } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import { lorebookMatchQuery, lorebookRankExpr } from '../search/ftsQuery.js';
import { toLorebookDetail, toLorebookSummary } from './serialize.js';

const listQuerySchema = z.object({
  q: z.string().optional(),
  fields: z.string().optional(),
  origin: z.enum(['embedded', 'standalone']).optional(),
  character_id: z.coerce.number().int().optional(),
  key: z.string().optional(),
  sort: z
    .enum(['name', 'created_at', 'updated_at', 'entry_count', 'text_length', 'relevance'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

const csv = (s: string | undefined): string[] =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function lorebooksRoutes(ctx: AppContext): Hono {
  const { db } = ctx;
  const app = new Hono();

  app.get('/', (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const match = p.q ? lorebookMatchQuery(p.q, csv(p.fields)) : null;

    const filters: string[] = [];
    const args: unknown[] = [];
    if (match) {
      filters.push('lorebooks_fts MATCH ?');
      args.push(match);
    }
    if (p.origin) {
      filters.push('lb.origin = ?');
      args.push(p.origin);
    }
    if (p.character_id !== undefined) {
      filters.push('lb.character_id = ?');
      args.push(p.character_id);
    }
    if (p.key) {
      filters.push(
        `lb.id IN (SELECT le.lorebook_id FROM lorebook_entries le
                   JOIN entry_keys ek ON ek.entry_id = le.id WHERE ek.key = ?)`,
      );
      args.push(p.key);
    }

    const from = match
      ? 'FROM lorebooks_fts JOIN lorebooks lb ON lb.id = lorebooks_fts.rowid LEFT JOIN characters ch ON ch.id = lb.character_id'
      : 'FROM lorebooks lb LEFT JOIN characters ch ON ch.id = lb.character_id';
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const sortKey = p.sort ?? (match ? 'relevance' : 'name');
    const order = p.order ?? (sortKey === 'name' ? 'asc' : sortKey === 'relevance' ? 'asc' : 'desc');
    const orderBy =
      sortKey === 'relevance' && match
        ? `${lorebookRankExpr()} ${order}`
        : sortKey === 'entry_count'
          ? `entry_count ${order}, lb.id asc`
          : sortKey === 'text_length'
            ? `text_length ${order}, lb.id asc`
            : sortKey === 'created_at' || sortKey === 'updated_at'
              ? `lb.${sortKey} ${order}, lb.id ${order}`
              : `lb.name COLLATE NOCASE ${order}, lb.id asc`;

    const snippetCol = match
      ? ", snippet(lorebooks_fts, -1, char(1), char(2), '…', 18) AS snip"
      : '';
    const select = `SELECT lb.id, lb.name, lb.origin, lb.character_id, lb.created_at, lb.updated_at,
        ch.name AS character_name,
        (SELECT COUNT(*) FROM lorebook_entries le WHERE le.lorebook_id = lb.id) AS entry_count,
        (SELECT COALESCE(SUM(LENGTH(le.content)), 0) FROM lorebook_entries le
         WHERE le.lorebook_id = lb.id) AS text_length${snippetCol}`;

    const total = (
      db.prepare(`SELECT COUNT(*) AS n ${from} ${where}`).get(...args) as { n: number }
    ).n;
    const rows = db
      .prepare(`${select} ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...args, p.limit, (p.page - 1) * p.limit) as Record<string, unknown>[];

    const body: Paginated<LorebookSummary> = {
      items: rows.map(toLorebookSummary),
      total,
      page: p.page,
      limit: p.limit,
    };
    return c.json(body);
  });

  app.get('/:id', (c) => {
    const id = Number(c.req.param('id'));
    const row = db
      .prepare(
        `SELECT lb.*, ch.name AS character_name
         FROM lorebooks lb LEFT JOIN characters ch ON ch.id = lb.character_id
         WHERE lb.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);

    const entries = db
      .prepare('SELECT * FROM lorebook_entries WHERE lorebook_id = ? ORDER BY position_idx')
      .all(id) as Record<string, unknown>[];
    return c.json(toLorebookDetail(row, entries));
  });

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'));
    const row = db.prepare('SELECT origin FROM lorebooks WHERE id = ?').get(id) as
      | { origin: string }
      | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.origin === 'embedded') {
      return c.json(
        { error: 'embedded lorebooks belong to their character; delete the character instead' },
        409,
      );
    }
    ctx.repo.transaction(() => ctx.repo.deleteLorebook(id));
    return c.json({ ok: true });
  });

  return app;
}
