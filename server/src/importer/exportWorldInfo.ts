/**
 * Converts a stored lorebook (header row + entry rows) into a standalone
 * SillyTavern world-info JSON document — used to export embedded lorebooks,
 * which have no original file of their own.
 */

const POSITION_TO_NUMBER: Record<string, number> = {
  before_char: 0,
  after_char: 1,
  before_authors_note: 2,
  after_authors_note: 3,
  at_depth: 4,
  before_example_messages: 5,
  after_example_messages: 6,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function buildWorldInfoExport(header: Row, entryRows: Row[]): unknown {
  const entries: Record<string, unknown> = {};
  entryRows.forEach((row, i) => {
    const posLabel: string = row.insert_position ?? '';
    const numeric = POSITION_TO_NUMBER[posLabel];
    entries[String(i)] = {
      uid: i,
      key: parseArr(row.keys_json),
      keysecondary: parseArr(row.secondary_keys_json),
      comment: row.comment ?? '',
      content: row.content ?? '',
      constant: !!row.constant,
      selective: !!row.selective,
      order: row.insertion_order ?? 0,
      position: numeric ?? (Number.isInteger(Number(posLabel)) && posLabel !== '' ? Number(posLabel) : 0),
      disable: !row.enabled,
      probability: row.probability ?? 100,
      useProbability: row.probability != null,
      ...(row.case_sensitive != null ? { caseSensitive: !!row.case_sensitive } : {}),
    };
  });

  return {
    name: header.name,
    description: header.description ?? '',
    ...(header.scan_depth != null ? { scan_depth: header.scan_depth } : {}),
    ...(header.token_budget != null ? { token_budget: header.token_budget } : {}),
    ...(header.recursive_scanning != null
      ? { recursive_scanning: !!header.recursive_scanning }
      : {}),
    entries,
  };
}

function parseArr(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
