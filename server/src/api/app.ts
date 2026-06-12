import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppContext } from '../context.js';
import { charactersRoutes } from './characters.js';
import { filesRoutes } from './files.js';
import { importsRoutes } from './imports.js';
import { lorebooksRoutes } from './lorebooks.js';
import { personaGroupsRoutes, personasRoutes } from './personas.js';
import { settingsRoutes } from './settings.js';

export function buildApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  // files first: its concrete paths (/characters/:id/avatar|export) must win
  // over the characters router's generic /:id
  app.route('/api', filesRoutes(ctx));
  app.route('/api/characters', charactersRoutes(ctx));
  app.route('/api/lorebooks', lorebooksRoutes(ctx));
  app.route('/api/personas', personasRoutes(ctx));
  app.route('/api/persona-groups', personaGroupsRoutes(ctx));
  app.route('/api/imports', importsRoutes(ctx));
  app.route('/api', settingsRoutes(ctx));

  // Production: serve the built SPA (vite dev server handles this in dev).
  const webDist = path.resolve(process.env.WEB_DIST ?? 'web/dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    const relRoot = path.relative(process.cwd(), webDist).replaceAll('\\', '/');
    app.use('/*', serveStatic({ root: relRoot }));
    const indexHtml = readFileSync(path.join(webDist, 'index.html'), 'utf8');
    app.get('*', (c) => c.html(indexHtml)); // SPA fallback for client routes
    console.log(`[web] serving SPA from ${webDist}`);
  }

  app.onError((err, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}
