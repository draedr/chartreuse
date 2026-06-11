import { describe, expect, it } from 'vitest';
import { extractTextChunks, readCardPayload } from '../src/importer/pngText.js';
import { readFixture } from './helpers.js';

describe('extractTextChunks', () => {
  it('extracts the chara tEXt chunk from a v2 card', () => {
    const chunks = extractTextChunks(readFixture('v2_card.png'));
    expect(chunks.map((c) => c.keyword)).toEqual(['chara']);
  });

  it('throws on non-PNG bytes', () => {
    expect(() => extractTextChunks(readFixture('malformed', 'not_a_png.png'))).toThrow(
      /not a PNG/,
    );
  });

  it('survives a truncated PNG without throwing', () => {
    const buf = readFixture('v2_card.png');
    const truncated = buf.subarray(0, buf.length - 20);
    expect(() => extractTextChunks(truncated)).not.toThrow();
  });
});

describe('readCardPayload', () => {
  it('decodes the v2 payload', () => {
    const payload = JSON.parse(readCardPayload(readFixture('v2_card.png')));
    expect(payload.spec).toBe('chara_card_v2');
    expect(payload.data.name).toBe('Mira the Cartographer');
  });

  it('prefers ccv3 over chara when both are present', () => {
    const payload = JSON.parse(readCardPayload(readFixture('v3_card.png')));
    expect(payload.spec).toBe('chara_card_v3');
    expect(payload.data.name).toBe('Vex of the Hollow');
  });

  it('throws when no character chunk exists', () => {
    expect(() => readCardPayload(readFixture('malformed', 'no_chara_chunk.png'))).toThrow(
      /no character metadata/,
    );
  });

  it('returns garbage (not JSON) for a bad-base64 chunk, so JSON.parse fails downstream', () => {
    const text = readCardPayload(readFixture('malformed', 'bad_base64.png'));
    expect(() => JSON.parse(text)).toThrow();
  });
});
