import { Hono } from 'hono';
import { z } from 'zod';
import type { SearchHit, SearchResponse } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import {
  CHARACTER_FTS_COLUMNS,
  LOREBOOK_FTS_COLUMNS,
  characterMatchQuery,
  characterRankExpr,
  lorebookMatchQuery,
  lorebookRankExpr,
} from '../search/ftsQuery.js';

const querySchema = z.object({
  q: z.string().default(''),
  fields: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Per-column matched-field detection: highlight(fts, i, m, '') returns the
 * column text unchanged when the column has no match, so comparing against the
 * stored column value identifies the first matching column.
 */
function matchedFieldCase(table: string, columns: readonly string[]): string {
  const whens = columns
    .map(
      (col, i) =>
        `WHEN highlight(${table}, ${i}, char(1), char(2)) <> ${table}.${col} THEN '${col}'`,
    )
    .join(' ');
  return `CASE ${whens} ELSE '' END`;
}

const csv = (s: string | undefined): string[] =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function searchRoutes(ctx: AppContext): Hono {
  const { db } = ctx;
  const app = new Hono();

  app.get('/', (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const { q, limit } = parsed.data;
    const fields = csv(parsed.data.fields);

    // When fields are scoped, an entity whose columns are all excluded gets no hits.
    const charFields = fields.filter((f) =>
      (CHARACTER_FTS_COLUMNS as readonly string[]).includes(f),
    );
    const lbFields = fields.filter((f) =>
      (LOREBOOK_FTS_COLUMNS as readonly string[]).includes(f),
    );
    const charMatch =
      fields.length > 0 && charFields.length === 0
        ? null
        : characterMatchQuery(q, charFields.length > 0 ? charFields : undefined);
    const lbMatch =
      fields.length > 0 && lbFields.length === 0
        ? null
        : lorebookMatchQuery(q, lbFields.length > 0 ? lbFields : undefined);

    const characters: SearchHit[] = charMatch
      ? (db
          .prepare(
            `SELECT c.id, c.name,
               snippet(characters_fts, -1, char(1), char(2), '…', 18) AS snippet,
               ${matchedFieldCase('characters_fts', CHARACTER_FTS_COLUMNS)} AS matchedField
             FROM characters_fts JOIN characters c ON c.id = characters_fts.rowid
             WHERE characters_fts MATCH ?
             ORDER BY ${characterRankExpr()} LIMIT ?`,
          )
          .all(charMatch, limit) as SearchHit[])
      : [];

    const lorebooks: SearchHit[] = lbMatch
      ? (db
          .prepare(
            `SELECT lb.id, lb.name,
               snippet(lorebooks_fts, -1, char(1), char(2), '…', 18) AS snippet,
               ${matchedFieldCase('lorebooks_fts', LOREBOOK_FTS_COLUMNS)} AS matchedField
             FROM lorebooks_fts JOIN lorebooks lb ON lb.id = lorebooks_fts.rowid
             WHERE lorebooks_fts MATCH ?
             ORDER BY ${lorebookRankExpr()} LIMIT ?`,
          )
          .all(lbMatch, limit) as SearchHit[])
      : [];

    const body: SearchResponse = { characters, lorebooks };
    return c.json(body);
  });

  return app;
}
