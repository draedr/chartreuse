import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Settings, TagCount } from '@chartreuse/shared';
import { saveSetting } from '../config.js';
import type { AppContext } from '../context.js';

const putSchema = z
  .object({
    watchCardsDir: z.string().min(1).optional(),
    watchLorebooksDir: z.string().min(1).optional(),
    rescanIntervalSec: z.coerce.number().int().min(10).max(86_400).optional(),
    renderHtml: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'no settings provided' });

function currentSettings(ctx: AppContext): Settings {
  const { db, config } = ctx;
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    watchCardsDir: config.watchCardsDir,
    watchLorebooksDir: config.watchLorebooksDir,
    rescanIntervalSec: config.rescanIntervalSec,
    renderHtml: config.renderHtml,
    counts: {
      characters: count('SELECT COUNT(*) AS n FROM characters'),
      lorebooks: count('SELECT COUNT(*) AS n FROM lorebooks'),
      quarantined: count(
        "SELECT COUNT(*) AS n FROM import_files WHERE status = 'quarantined'",
      ),
    },
  };
}

export function settingsRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/settings', (c) => c.json(currentSettings(ctx)));

  app.put('/settings', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid settings', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    // Only watcher-relevant changes trigger a (costly) watcher restart.
    let restartWatchers = false;

    for (const [field, key] of [
      ['watchCardsDir', 'watch_cards_dir'],
      ['watchLorebooksDir', 'watch_lorebooks_dir'],
    ] as const) {
      const value = p[field];
      if (value === undefined) continue;
      const abs = path.resolve(value);
      try {
        mkdirSync(abs, { recursive: true });
      } catch (err) {
        return c.json(
          { error: `cannot create or access directory for ${field}: ${String(err)}` },
          400,
        );
      }
      saveSetting(ctx.db, key, abs);
      ctx.config[field] = abs;
      restartWatchers = true;
    }
    if (p.rescanIntervalSec !== undefined) {
      saveSetting(ctx.db, 'rescan_interval_sec', String(p.rescanIntervalSec));
      ctx.config.rescanIntervalSec = p.rescanIntervalSec;
      restartWatchers = true;
    }
    if (p.renderHtml !== undefined) {
      saveSetting(ctx.db, 'render_html', String(p.renderHtml));
      ctx.config.renderHtml = p.renderHtml;
    }

    if (restartWatchers) await ctx.onSettingsChanged?.();
    return c.json(currentSettings(ctx));
  });

  app.get('/tags', (c) => {
    const rows = ctx.db
      .prepare(
        `SELECT t.name, COUNT(ct.character_id) AS count
         FROM tags t JOIN character_tags ct ON ct.tag_id = t.id
         GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`,
      )
      .all() as TagCount[];
    return c.json(rows);
  });

  app.post('/admin/reindex', (c) => {
    ctx.repo.rebuildFts();
    return c.json({ ok: true }, 202);
  });

  return app;
}
