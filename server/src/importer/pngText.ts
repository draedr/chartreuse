/**
 * Minimal read-only PNG tEXt chunk extraction. Character cards store their
 * payload base64-encoded in a tEXt chunk keyed 'chara' (v2) or 'ccv3' (v3).
 * We never write PNGs, so no CRC validation or encoding is needed.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngTextChunk {
  keyword: string;
  text: string;
}

export function extractTextChunks(buf: Buffer): PngTextChunk[] {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  const chunks: PngTextChunk[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    // Truncated chunk: stop walking, keep whatever we already collected.
    if (dataEnd + 4 > buf.length) break;
    if (type === 'tEXt') {
      const data = buf.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        chunks.push({
          keyword: data.toString('latin1', 0, nul),
          text: data.toString('latin1', nul + 1),
        });
      }
    }
    if (type === 'IEND') break;
    off = dataEnd + 4; // skip CRC
  }
  return chunks;
}

/**
 * Returns the decoded character JSON string from a card PNG.
 * 'ccv3' takes precedence over 'chara'.
 */
export function readCardPayload(buf: Buffer): string {
  const chunks = extractTextChunks(buf);
  const pick = (kw: string) =>
    chunks.find((c) => c.keyword.toLowerCase() === kw);
  const chunk = pick('ccv3') ?? pick('chara');
  if (!chunk) {
    throw new Error('PNG has no character metadata (chara/ccv3 tEXt chunk)');
  }
  return Buffer.from(chunk.text, 'base64').toString('utf8');
}
