/**
 * Builds safe FTS5 MATCH expressions from raw user input. Every term is
 * emitted as a quoted string (neutralizing AND/OR/NOT, colons, parens, etc.);
 * bare words get a `*` prefix-match suffix, quoted phrases stay exact.
 */

export const CHARACTER_FTS_COLUMNS = [
  'name',
  'creator',
  'tags',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'alternate_greetings',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
] as const;

export const LOREBOOK_FTS_COLUMNS = [
  'name',
  'description',
  'entry_keys',
  'entry_content',
  'entry_comments',
] as const;

/** bm25 weights, in FTS column order. Lower bm25 = better; weights scale per-column relevance. */
export const CHARACTER_BM25_WEIGHTS = [10, 6, 8, 4, 3, 3, 2, 1, 1, 2, 1, 1] as const;
export const LOREBOOK_BM25_WEIGHTS = [10, 4, 8, 2, 2] as const;

/** A token is only usable if the tokenizer will get at least one letter/digit out of it. */
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

function quote(term: string): string {
  return `"${term.replaceAll('"', '')}"`;
}

/**
 * Returns an FTS5 MATCH expression, or null if the input has no searchable
 * content (callers fall back to browse mode).
 */
export function buildMatchQuery(
  input: string,
  fields?: readonly string[],
  allowedColumns?: readonly string[],
): string | null {
  const terms: string[] = [];
  const tokenRe = /"([^"]*)"|(\S+)/g;
  for (const m of input.matchAll(tokenRe)) {
    const phrase = m[1];
    const word = m[2];
    if (phrase !== undefined) {
      const clean = phrase.trim();
      if (HAS_WORD_CHAR.test(clean)) terms.push(quote(clean));
    } else if (word !== undefined) {
      const clean = word.replaceAll('*', '');
      if (HAS_WORD_CHAR.test(clean)) terms.push(`${quote(clean)}*`);
    }
  }
  if (terms.length === 0) return null;

  const query = terms.join(' ');
  if (fields && allowedColumns) {
    const valid = fields.filter((f) => allowedColumns.includes(f));
    if (valid.length > 0 && valid.length < allowedColumns.length) {
      return `{${valid.join(' ')}}: (${query})`;
    }
  }
  return query;
}

export function characterMatchQuery(input: string, fields?: readonly string[]): string | null {
  return buildMatchQuery(input, fields, CHARACTER_FTS_COLUMNS);
}

export function lorebookMatchQuery(input: string, fields?: readonly string[]): string | null {
  return buildMatchQuery(input, fields, LOREBOOK_FTS_COLUMNS);
}

export function characterRankExpr(table = 'characters_fts'): string {
  return `bm25(${table}, ${CHARACTER_BM25_WEIGHTS.join(', ')})`;
}

export function lorebookRankExpr(table = 'lorebooks_fts'): string {
  return `bm25(${table}, ${LOREBOOK_BM25_WEIGHTS.join(', ')})`;
}
