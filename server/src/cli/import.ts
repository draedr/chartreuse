/**
 * Manual import CLI for testing without the watcher:
 *   npm run import -- <file> [card|lorebook]
 * Kind defaults to 'card' for .png, and to 'card' for .json unless 'lorebook' is given.
 */
import path from 'node:path';
import { loadEnvConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { Storage } from '../files/storage.js';
import { importFile, type ImportKind } from '../importer/importFile.js';
import { Repository } from '../importer/repository.js';

const [, , fileArg, kindArg] = process.argv;
if (!fileArg) {
  console.error('usage: npm run import -- <file> [card|lorebook]');
  process.exit(1);
}
const kind: ImportKind = kindArg === 'lorebook' ? 'lorebook' : 'card';

const config = loadEnvConfig();
const storage = new Storage(config.dataDir);
const db = openDb(storage.dbPath);
migrate(db);

const result = importFile(
  { repo: new Repository(db), storage },
  path.resolve(fileArg),
  kind,
);
console.log(JSON.stringify(result, null, 2));
db.close();
process.exit(result.outcome === 'error' ? 1 : 0);
