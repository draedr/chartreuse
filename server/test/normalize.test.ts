import { describe, expect, it } from 'vitest';
import { normalizeCharacter, normalizeLorebook } from '../src/importer/normalize.js';
import { hashPayload, stableStringify } from '../src/importer/hash.js';
import { readFixtureJson } from './helpers.js';

describe('normalizeCharacter', () => {
  it('normalizes a v2 card with embedded book', () => {
    const c = normalizeCharacter(readFixtureJson('v2_card.json'));
    expect(c.spec).toBe('chara_card_v2');
    expect(c.name).toBe('Mira the Cartographer');
    expect(c.tags).toEqual(['Fantasy', 'Adventure', 'OC']);
    expect(c.alternateGreetings).toHaveLength(2);
    expect(c.extensions).toMatchObject({ talkativeness: '0.5' });

    expect(c.book).not.toBeNull();
    expect(c.book!.name).toBe('Eldoria Atlas');
    expect(c.book!.scanDepth).toBe(50);
    expect(c.book!.entries).toHaveLength(2);
    const [e1, e2] = c.book!.entries;
    expect(e1!.keys).toEqual(['Eldoria', 'floating isles']);
    expect(e1!.insertPosition).toBe('before_char');
    expect(e2!.secondaryKeys).toEqual(['port']);
    expect(e2!.constant).toBe(true);
  });

  it('wraps a bare v1-style card as v2', () => {
    const c = normalizeCharacter(readFixtureJson('v1_bare.json'));
    expect(c.spec).toBe('chara_card_v2');
    expect(c.name).toBe('Plain Pete');
    expect(c.firstMes).toContain('extremely normal');
    expect(c.book).toBeNull();
    expect(c.tags).toEqual([]);
  });

  it('rejects unrecognizable payloads', () => {
    expect(() => normalizeCharacter(readFixtureJson('malformed', 'wrong_schema.json'))).toThrow(
      /not a recognizable character card/,
    );
    expect(() => normalizeCharacter({ data: { name: '' } })).toThrow();
    expect(() => normalizeCharacter(null)).toThrow();
  });

  it('deduplicates tags and drops blank ones', () => {
    const c = normalizeCharacter({
      name: 'Tag Test',
      tags: ['a', 'a', ' ', '', 'b', 7],
    });
    expect(c.tags).toEqual(['a', 'b', '7']);
  });
});

describe('normalizeLorebook', () => {
  it('normalizes standalone world-info (keyed entries, key/keysecondary/disable)', () => {
    const lb = normalizeLorebook(readFixtureJson('worldinfo_standalone.json'), 'fallback');
    expect(lb.name).toBe('Astraea Codex');
    expect(lb.entries).toHaveLength(2);

    // sorted by insertionOrder: uid 1 (order 90) before uid 0 (order 100)
    const [battleSong, sages] = lb.entries;
    expect(battleSong!.sourceUid).toBe('1');
    expect(battleSong!.keys).toEqual(['Battle Song']);
    expect(battleSong!.enabled).toBe(false); // disable: true → enabled: false
    expect(battleSong!.constant).toBe(true);
    expect(battleSong!.insertPosition).toBe('at_depth'); // position 4
    expect(battleSong!.extensions).toMatchObject({ depth: 2, group: 'systems' });

    expect(sages!.keys).toEqual(['Sages', 'Grand Sage']);
    expect(sages!.secondaryKeys).toEqual(['council']);
    expect(sages!.enabled).toBe(true);
    expect(sages!.insertPosition).toBe('before_char'); // position 0
  });

  it('normalizes a standalone character_book-format file (array entries)', () => {
    const lb = normalizeLorebook(readFixtureJson('charbook_standalone.json'), 'fallback');
    expect(lb.name).toBe('Verdant Vale Guide');
    expect(lb.recursiveScanning).toBe(true);
    expect(lb.entries).toHaveLength(1);
    expect(lb.entries[0]!.keys).toEqual(['Verdant Vale']);
    expect(lb.entries[0]!.enabled).toBe(true);
    expect(lb.entries[0]!.sourceUid).toBe('7');
  });

  it('falls back to the provided name when the book has none', () => {
    const lb = normalizeLorebook({ entries: [] }, 'Mira the Cartographer');
    expect(lb.name).toBe('Mira the Cartographer');
  });

  it('rejects payloads without entries', () => {
    expect(() => normalizeLorebook({ name: 'x' }, 'f')).toThrow(/no entries/);
  });
});

describe('stableStringify / hashPayload', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
    expect(hashPayload({ x: 1, y: 2 })).toBe(hashPayload({ y: 2, x: 1 }));
  });

  it('distinguishes different payloads', () => {
    expect(hashPayload({ x: 1 })).not.toBe(hashPayload({ x: 2 }));
  });
});
