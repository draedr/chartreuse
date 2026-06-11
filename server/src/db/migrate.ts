import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

/**
 * Applies pending .sql migrations in filename order, tracked via
 * PRAGMA user_version (the numeric prefix of the filename).
 */
export function migrate(db: Db, migrationsDir: string = MIGRATIONS_DIR): void {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`migration filename must start with a number: ${file}`);
    }
    const current = db.pragma('user_version', { simple: true }) as number;
    if (version <= current) continue;

    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
