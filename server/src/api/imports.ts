import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type {
  ImportLogRow,
  ImportUploadResult,
  Paginated,
  QuarantineRow,
} from '@chartreuse/shared';
import type { AppContext } from '../context.js';

const MAX_CARD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_FILES = 200;

const listSchema = z.object({
  status: z
    .enum(['imported', 'updated', 'duplicate', 'quarantined', 'removed', 'error'])
    .optional(),
  kind: z.enum(['card', 'lorebook']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const quarantineSchema = z.object({
  kind: z.enum(['card', 'lorebook']).optional(),
});

export function importsRoutes(ctx: AppContext): Hono {
  const { db } = ctx;
  const app = new Hono();

  app.get('/', (c) => {
    const parsed = listSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const filters: string[] = [];
    const args: unknown[] = [];
    if (p.status) {
      filters.push('action = ?');
      args.push(p.status);
    }
    if (p.kind) {
      filters.push('kind = ?');
      args.push(p.kind);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM import_log ${where}`).get(...args) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT id, at, path, kind, action, detail, entity_type, entity_id
         FROM import_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, p.limit, (p.page - 1) * p.limit) as Record<string, unknown>[];

    const body: Paginated<ImportLogRow> = {
      items: rows.map((r) => ({
        id: r.id as number,
        at: r.at as string,
        path: r.path as string,
        kind: r.kind as 'card' | 'lorebook',
        action: r.action as ImportLogRow['action'],
        detail: r.detail as string | null,
        entityType: r.entity_type as 'character' | 'lorebook' | null,
        entityId: r.entity_id as number | null,
      })),
      total,
      page: p.page,
      limit: p.limit,
    };
    return c.json(body);
  });

  app.get('/status', (c) => {
    const idle = { active: false, total: 0, processed: 0, watching: false };
    return c.json(ctx.getImportStatus?.() ?? { card: idle, lorebook: idle });
  });

  // Frontend card upload: each file is saved into the watched cards folder and
  // imported. Byte-identical files are skipped; everything else is a new card.
  app.post('/upload', async (c) => {
    if (!ctx.importUploadedCard) return c.json({ error: 'importer not running' }, 503);

    let body: Record<string, string | File | (string | File)[]>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ error: 'expected multipart form-data' }, 400);
    }
    const raw = body['file'] ?? body['files'];
    const files = (Array.isArray(raw) ? raw : [raw]).filter(
      (f): f is File => f instanceof File,
    );
    if (files.length === 0) return c.json({ error: 'no files provided' }, 400);
    if (files.length > MAX_UPLOAD_FILES) {
      return c.json({ error: `too many files (max ${MAX_UPLOAD_FILES})` }, 400);
    }

    const results: ImportUploadResult[] = [];
    for (const file of files) {
      const filename = file.name && file.name.trim() ? file.name : 'card.png';
      if (file.size > MAX_CARD_BYTES) {
        results.push({ filename, outcome: 'error', error: 'file too large (max 20 MB)' });
        continue;
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const res = await ctx.importUploadedCard(filename, bytes);
      const outcome: ImportUploadResult['outcome'] =
        res.outcome === 'imported' || res.outcome === 'updated'
          ? 'imported'
          : res.outcome === 'duplicate'
            ? 'duplicate'
            : res.outcome === 'quarantined'
              ? 'quarantined'
              : 'error';
      results.push({
        filename,
        outcome,
        characterId: res.entityId,
        error: res.error,
      });
    }
    return c.json({ results });
  });

  app.post('/rescan', (c) => {
    if (!ctx.requestRescan) return c.json({ error: 'watcher not running' }, 503);
    ctx.requestRescan();
    return c.json({ ok: true }, 202);
  });

  app.get('/quarantine', (c) => {
    const parsed = quarantineSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const kind = parsed.data.kind;
    const rows = db
      .prepare(
        `SELECT id, path, kind, error, last_processed_at
         FROM import_files WHERE status = 'quarantined' ${kind ? 'AND kind = ?' : ''}
         ORDER BY last_processed_at DESC`,
      )
      .all(...(kind ? [kind] : [])) as Record<string, unknown>[];
    const body: QuarantineRow[] = rows.map((r) => ({
      id: r.id as number,
      path: r.path as string,
      kind: r.kind as 'card' | 'lorebook',
      error: r.error as string | null,
      lastProcessedAt: r.last_processed_at as string,
    }));
    return c.json(body);
  });

  app.post('/quarantine/:id/retry', (c) => {
    const id = Number(c.req.param('id'));
    const row = db
      .prepare("SELECT path, kind FROM import_files WHERE id = ? AND status = 'quarantined'")
      .get(id) as { path: string; kind: 'card' | 'lorebook' } | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);
    if (!existsSync(row.path)) {
      return c.json({ error: 'source file no longer exists' }, 410);
    }
    if (!ctx.enqueueImport) return c.json({ error: 'importer not running' }, 503);
    ctx.enqueueImport(row.path, row.kind, true); // force: bytes are unchanged by definition
    return c.json({ ok: true }, 202);
  });

  return app;
}
