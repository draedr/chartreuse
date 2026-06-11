// Copies non-TS assets (SQL migrations) into dist so `node dist/index.js` works.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
cpSync(
  path.join(root, '..', 'src', 'db', 'migrations'),
  path.join(root, '..', 'dist', 'db', 'migrations'),
  { recursive: true },
);
console.log('copied migrations to dist');
