import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURES, ...parts);
}

export function readFixture(...parts: string[]): Buffer {
  return readFileSync(fixturePath(...parts));
}

export function readFixtureJson(...parts: string[]): unknown {
  return JSON.parse(readFixture(...parts).toString('utf8'));
}
