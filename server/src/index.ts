import { serve } from '@hono/node-server';
import { loadEnvConfig, applyStoredSettings } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { Storage } from './files/storage.js';
import { ImportQueue } from './importer/queue.js';
import { importUploadedCard } from './importer/importFile.js';
import { Repository } from './importer/repository.js';
import { WatchService } from './watcher/watcher.js';
import { buildApp } from './api/app.js';
import type { AppContext } from './context.js';

const envConfig = loadEnvConfig();
const storage = new Storage(envConfig.dataDir);
const db = openDb(storage.dbPath);
migrate(db);
const config = applyStoredSettings(db, envConfig);
const repo = new Repository(db);

const ctx: AppContext = { db, storage, config, repo };

const queue = new ImportQueue();
const watcher = new WatchService(ctx, queue);
ctx.onSettingsChanged = () => watcher.restart();
ctx.requestRescan = () => watcher.requestRescan();
ctx.enqueueImport = (path, kind, force) => watcher.enqueueSingle(path, kind, force);
ctx.getImportStatus = () => watcher.status();
ctx.importUploadedCard = (filename, bytes) =>
  queue.enqueue(() =>
    importUploadedCard({ repo, storage }, config.watchCardsDir, filename, bytes),
  );

const app = buildApp(ctx);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`chartreuse listening on http://localhost:${info.port}`);
  console.log(`  data dir: ${config.dataDir}`);
  watcher.start();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void watcher.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}
