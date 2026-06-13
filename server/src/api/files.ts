import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { AppContext } from '../context.js';
import { buildWorldInfoExport } from '../importer/exportWorldInfo.js';

function attachmentHeaders(filename: string, contentType: string): Record<string, string> {
  // Header values are Latin-1 (ByteString): the quoted filename must be ASCII,
  // so non-ASCII names (emoji, surrogate pairs) only ride in the UTF-8 filename*.
  // eslint-disable-next-line no-control-regex
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}

/** Avatar + original-file download endpoints, mounted under /api. */
export function filesRoutes(ctx: AppContext): Hono {
  const { db, storage } = ctx;
  const app = new Hono();

  app.get('/characters/:id/avatar', (c) => {
    const id = Number(c.req.param('id'));
    const row = db
      .prepare('SELECT has_avatar, updated_at FROM characters WHERE id = ?')
      .get(id) as { has_avatar: number; updated_at: string } | undefined;
    if (!row?.has_avatar) return c.json({ error: 'no avatar' }, 404);
    const p = storage.avatarPath(id);
    if (!existsSync(p)) return c.json({ error: 'no avatar' }, 404);
    return c.body(new Uint8Array(readFileSync(p)), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
    });
  });

  app.get('/characters/:id/export', (c) => {
    const id = Number(c.req.param('id'));
    const row = db
      .prepare('SELECT original_hash, original_ext, original_filename FROM characters WHERE id = ?')
      .get(id) as
      | { original_hash: string; original_ext: 'png' | 'json'; original_filename: string }
      | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);
    const p = storage.originalPath(row.original_hash, row.original_ext);
    if (!existsSync(p)) return c.json({ error: 'original file missing from storage' }, 410);
    const contentType = row.original_ext === 'png' ? 'image/png' : 'application/json';
    return c.body(
      new Uint8Array(readFileSync(p)),
      200,
      attachmentHeaders(row.original_filename, contentType),
    );
  });

  app.get('/lorebooks/:id/export', (c) => {
    const id = Number(c.req.param('id'));
    const row = db.prepare('SELECT * FROM lorebooks WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);

    // Standalone books export their byte-identical original file.
    if (row.origin === 'standalone' && row.original_hash) {
      const p = storage.originalPath(row.original_hash as string, 'json');
      if (existsSync(p)) {
        return c.body(
          new Uint8Array(readFileSync(p)),
          200,
          attachmentHeaders((row.original_filename as string) ?? `${row.name}.json`, 'application/json'),
        );
      }
    }

    // Embedded books (or missing originals) export as converted world-info JSON.
    const entries = db
      .prepare('SELECT * FROM lorebook_entries WHERE lorebook_id = ? ORDER BY position_idx')
      .all(id) as Record<string, unknown>[];
    const doc = buildWorldInfoExport(row, entries);
    return c.body(
      JSON.stringify(doc, null, 2),
      200,
      attachmentHeaders(`${row.name as string}.json`, 'application/json'),
    );
  });

  return app;
}
