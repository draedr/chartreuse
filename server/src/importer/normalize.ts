import { z } from 'zod';
import {
  asBool,
  asBoolOrNull,
  asNumberOrNull,
  asRecord,
  asString,
  asStringArray,
} from './coerce.js';

export interface NormalizedEntry {
  sourceUid: string | null;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  comment: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  insertionOrder: number;
  insertPosition: string;
  caseSensitive: boolean | null;
  priority: number | null;
  probability: number | null;
  extensions: Record<string, unknown>;
}

export interface NormalizedLorebook {
  name: string;
  description: string;
  scanDepth: number | null;
  tokenBudget: number | null;
  recursiveScanning: boolean | null;
  extensions: Record<string, unknown>;
  entries: NormalizedEntry[];
  /** Original payload, persisted as raw_json. */
  raw: unknown;
}

export interface NormalizedCharacter {
  spec: 'chara_card_v2' | 'chara_card_v3';
  specVersion: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creator: string;
  characterVersion: string;
  alternateGreetings: string[];
  tags: string[];
  extensions: Record<string, unknown>;
  book: NormalizedLorebook | null;
  /** Original payload (parsed card JSON), persisted as raw_json + hashed for dedupe. */
  raw: unknown;
}

// Minimal structural requirements; everything else is coerced tolerantly.
const wrappedCardSchema = z.object({
  spec: z.string().optional(),
  spec_version: z.unknown().optional(),
  data: z.object({ name: z.string().min(1) }).passthrough(),
});
const bareCardSchema = z.object({ name: z.string().min(1) }).passthrough();

/** SillyTavern world-info numeric position → canonical label. */
const WORLD_INFO_POSITIONS: Record<number, string> = {
  0: 'before_char',
  1: 'after_char',
  2: 'before_authors_note',
  3: 'after_authors_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
};

/** character_book-format entry (array entries, keys/secondary_keys/enabled). */
function normalizeBookEntry(raw: unknown, index: number): NormalizedEntry {
  const e = asRecord(raw);
  const known = new Set([
    'id', 'keys', 'secondary_keys', 'content', 'comment', 'name', 'enabled',
    'constant', 'selective', 'insertion_order', 'position', 'case_sensitive',
    'priority', 'probability', 'extensions',
  ]);
  const leftovers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!known.has(k)) leftovers[k] = v;
  }
  const uid = e.id ?? null;
  return {
    sourceUid: uid === null ? null : asString(uid, String(index)),
    keys: asStringArray(e.keys),
    secondaryKeys: asStringArray(e.secondary_keys),
    content: asString(e.content),
    comment: asString(e.comment) || asString(e.name),
    enabled: asBool(e.enabled, true),
    constant: asBool(e.constant, false),
    selective: asBool(e.selective, false),
    insertionOrder: asNumberOrNull(e.insertion_order) ?? 0,
    insertPosition: asString(e.position),
    caseSensitive: asBoolOrNull(e.case_sensitive),
    priority: asNumberOrNull(e.priority),
    probability: asNumberOrNull(e.probability),
    extensions: { ...asRecord(e.extensions), ...leftovers },
  };
}

/** Standalone world-info entry (keyed object, key/keysecondary/disable). */
function normalizeWorldInfoEntry(raw: unknown, fallbackUid: string): NormalizedEntry {
  const e = asRecord(raw);
  const known = new Set([
    'uid', 'key', 'keysecondary', 'content', 'comment', 'disable', 'constant',
    'selective', 'order', 'position', 'caseSensitive', 'case_sensitive',
    'priority', 'probability', 'extensions',
  ]);
  const leftovers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!known.has(k)) leftovers[k] = v;
  }
  const pos = asNumberOrNull(e.position);
  return {
    sourceUid: e.uid !== undefined ? asString(e.uid, fallbackUid) : fallbackUid,
    keys: asStringArray(e.key),
    secondaryKeys: asStringArray(e.keysecondary),
    content: asString(e.content),
    comment: asString(e.comment),
    enabled: !asBool(e.disable, false),
    constant: asBool(e.constant, false),
    selective: asBool(e.selective, false),
    insertionOrder: asNumberOrNull(e.order) ?? 0,
    insertPosition:
      pos !== null ? (WORLD_INFO_POSITIONS[pos] ?? String(pos)) : asString(e.position),
    caseSensitive: asBoolOrNull(e.caseSensitive ?? e.case_sensitive),
    priority: asNumberOrNull(e.priority),
    probability: asNumberOrNull(e.probability),
    extensions: { ...asRecord(e.extensions), ...leftovers },
  };
}

function normalizeBookHeader(
  b: Record<string, unknown>,
  fallbackName: string,
): Omit<NormalizedLorebook, 'entries' | 'raw'> {
  return {
    name: asString(b.name).trim() || fallbackName,
    description: asString(b.description),
    scanDepth: asNumberOrNull(b.scan_depth ?? b.scanDepth),
    tokenBudget: asNumberOrNull(b.token_budget ?? b.tokenBudget),
    recursiveScanning: asBoolOrNull(b.recursive_scanning ?? b.recursiveScanning),
    extensions: asRecord(b.extensions),
  };
}

/**
 * Normalizes a lorebook payload of either shape:
 *  - character_book format: entries is an ARRAY with keys/secondary_keys/enabled
 *  - SillyTavern world-info: entries is an OBJECT keyed by uid with key/keysecondary/disable
 */
export function normalizeLorebook(payload: unknown, fallbackName: string): NormalizedLorebook {
  const b = asRecord(payload);
  const rawEntries = b.entries;

  let entries: NormalizedEntry[];
  if (Array.isArray(rawEntries)) {
    entries = rawEntries.map((e, i) => normalizeBookEntry(e, i));
  } else if (rawEntries !== null && typeof rawEntries === 'object') {
    entries = Object.entries(rawEntries as Record<string, unknown>).map(([uid, e]) =>
      normalizeWorldInfoEntry(e, uid),
    );
    // World-info objects have no inherent order; sort by insertion order, then uid.
    entries.sort(
      (a, b2) =>
        a.insertionOrder - b2.insertionOrder ||
        (a.sourceUid ?? '').localeCompare(b2.sourceUid ?? '', undefined, { numeric: true }),
    );
  } else {
    throw new Error('lorebook has no entries array/object');
  }

  return { ...normalizeBookHeader(b, fallbackName), entries, raw: payload };
}

/**
 * Normalizes a parsed character card payload. Accepts v2/v3 wrapped cards and
 * bare v1-style cards (top-level name/description/...), which are recorded as v2.
 */
export function normalizeCharacter(payload: unknown): NormalizedCharacter {
  const root = asRecord(payload);

  let data: Record<string, unknown>;
  let spec: 'chara_card_v2' | 'chara_card_v3';
  let specVersion: string;

  const wrapped = wrappedCardSchema.safeParse(root);
  if (wrapped.success) {
    data = asRecord(root.data);
    spec = root.spec === 'chara_card_v3' ? 'chara_card_v3' : 'chara_card_v2';
    specVersion = asString(root.spec_version, spec === 'chara_card_v3' ? '3.0' : '2.0');
  } else if (bareCardSchema.safeParse(root).success && root.data === undefined) {
    data = root; // v1-style bare card
    spec = 'chara_card_v2';
    specVersion = '2.0';
  } else {
    throw new Error('not a recognizable character card (missing data.name / name)');
  }

  const name = asString(data.name).trim();
  if (!name) throw new Error('character card has an empty name');

  let book: NormalizedLorebook | null = null;
  if (data.character_book !== undefined && data.character_book !== null) {
    book = normalizeLorebook(data.character_book, name);
  }

  return {
    spec,
    specVersion,
    name,
    description: asString(data.description),
    personality: asString(data.personality),
    scenario: asString(data.scenario),
    firstMes: asString(data.first_mes),
    mesExample: asString(data.mes_example),
    creatorNotes: asString(data.creator_notes),
    systemPrompt: asString(data.system_prompt),
    postHistoryInstructions: asString(data.post_history_instructions),
    creator: asString(data.creator),
    characterVersion: asString(data.character_version),
    alternateGreetings: asStringArray(data.alternate_greetings),
    tags: [...new Set(asStringArray(data.tags))],
    extensions: asRecord(data.extensions),
    book,
    raw: payload,
  };
}
