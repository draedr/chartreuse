import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CHARACTER_FTS_COLUMNS,
  buildMatchQuery,
  characterMatchQuery,
} from '../src/search/ftsQuery.js';

// Real in-memory FTS5 table: the builder's output must never throw in MATCH.
const db = new Database(':memory:');
db.exec("CREATE VIRTUAL TABLE probe USING fts5(name, description, tokenize='unicode61')");
db.prepare('INSERT INTO probe (rowid, name, description) VALUES (1, ?, ?)').run(
  'Mira the Cartographer',
  'charting the floating isles',
);
afterAll(() => db.close());

function matches(match: string): number[] {
  return (
    db.prepare('SELECT rowid FROM probe WHERE probe MATCH ?').all(match) as { rowid: number }[]
  ).map((r) => r.rowid);
}

describe('buildMatchQuery', () => {
  it('prefix-matches bare terms', () => {
    const q = buildMatchQuery('cart');
    expect(q).toBe('"cart"*');
    expect(matches(q!)).toEqual([1]);
  });

  it('ANDs multiple terms', () => {
    expect(matches(buildMatchQuery('mira charting')!)).toEqual([1]);
    expect(matches(buildMatchQuery('mira zeppelin')!)).toEqual([]);
  });

  it('keeps quoted phrases exact', () => {
    expect(buildMatchQuery('"floating isles"')).toBe('"floating isles"');
    expect(matches('"floating isles"')).toEqual([1]);
    expect(matches(buildMatchQuery('"isles floating"')!)).toEqual([]);
  });

  it('returns null for empty or unsearchable input', () => {
    expect(buildMatchQuery('')).toBeNull();
    expect(buildMatchQuery('   ')).toBeNull();
    expect(buildMatchQuery('*** ()) ^-- ""')).toBeNull();
  });

  it('scopes to a column set', () => {
    const q = characterMatchQuery('mira', ['name', 'description']);
    expect(q).toBe('{name description}: ("mira"*)');
    // and drops scoping when every column is selected
    expect(characterMatchQuery('mira', [...CHARACTER_FTS_COLUMNS])).toBe('"mira"*');
    // unknown fields are ignored
    expect(characterMatchQuery('mira', ['name', 'bogus'])).toBe('{name}: ("mira"*)');
  });

  it('never produces a MATCH expression that throws (fuzz)', () => {
    const nasty = [
      'AND OR NOT',
      'a:b:c {x}: (y)',
      '"unclosed phrase',
      'NEAR(a b)',
      'col:term^4',
      '-excluded +required',
      'paren) (open',
      '日本語 émigré test*',
      '"" "" ""',
      '\\ // \\\\',
      '*"*"*',
      String.fromCharCode(1, 2, 3),
      '🎴 cards',
    ];
    for (const input of nasty) {
      const q = buildMatchQuery(input);
      if (q !== null) {
        expect(() => matches(q), `input: ${JSON.stringify(input)} → ${q}`).not.toThrow();
      }
    }
  });
});
