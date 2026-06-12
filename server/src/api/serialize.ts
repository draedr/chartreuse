import type {
  CharacterDetail,
  CharacterSummary,
  LorebookDetail,
  LorebookEntry,
  LorebookSummary,
  Spec,
} from '@chartreuse/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function toCharacterSummary(row: Row, tags: string[]): CharacterSummary {
  const summary: CharacterSummary = {
    id: row.id,
    name: row.name,
    creator: row.creator,
    tags,
    spec: row.spec as Spec,
    hasAvatar: !!row.has_avatar,
    hasLorebook: !!row.has_lorebook,
    textLength: row.text_length ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof row.snip === 'string' && row.snip.length > 0) summary.snippet = row.snip;
  return summary;
}

export function toCharacterDetail(
  row: Row,
  tags: string[],
  greetings: string[],
  lorebooks: { id: number; name: string; origin: 'embedded' | 'standalone'; entry_count: number }[],
): CharacterDetail {
  return {
    id: row.id,
    name: row.name,
    creator: row.creator,
    tags,
    spec: row.spec as Spec,
    specVersion: row.spec_version,
    hasAvatar: !!row.has_avatar,
    hasLorebook: lorebooks.length > 0,
    textLength: row.text_length ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMes: row.first_mes,
    mesExample: row.mes_example,
    creatorNotes: row.creator_notes,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    characterVersion: row.character_version,
    alternateGreetings: greetings,
    lorebooks: lorebooks.map((lb) => ({
      id: lb.id,
      name: lb.name,
      origin: lb.origin,
      entryCount: lb.entry_count,
    })),
    extensions: safeParse(row.extensions_json),
    originalFilename: row.original_filename,
    originalExt: row.original_ext,
  };
}

export function toLorebookSummary(row: Row): LorebookSummary {
  const summary: LorebookSummary = {
    id: row.id,
    name: row.name,
    origin: row.origin,
    character:
      row.character_id != null
        ? { id: row.character_id, name: row.character_name ?? '' }
        : null,
    entryCount: row.entry_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof row.snip === 'string' && row.snip.length > 0) summary.snippet = row.snip;
  return summary;
}

export function toLorebookEntry(row: Row): LorebookEntry {
  return {
    id: row.id,
    positionIdx: row.position_idx,
    sourceUid: row.source_uid,
    keys: safeParseArray(row.keys_json),
    secondaryKeys: safeParseArray(row.secondary_keys_json),
    content: row.content,
    comment: row.comment,
    enabled: !!row.enabled,
    constant: !!row.constant,
    selective: !!row.selective,
    insertionOrder: row.insertion_order,
    insertPosition: row.insert_position,
    caseSensitive: row.case_sensitive === null ? null : !!row.case_sensitive,
    priority: row.priority,
    probability: row.probability,
  };
}

export function toLorebookDetail(row: Row, entries: Row[]): LorebookDetail {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    character:
      row.character_id != null
        ? { id: row.character_id, name: row.character_name ?? '' }
        : null,
    entryCount: entries.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: row.description,
    scanDepth: row.scan_depth,
    tokenBudget: row.token_budget,
    recursiveScanning: row.recursive_scanning === null ? null : !!row.recursive_scanning,
    entries: entries.map(toLorebookEntry),
    extensions: safeParse(row.extensions_json),
  };
}

export function safeParse(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string') return {};
  try {
    const v = JSON.parse(json);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function safeParseArray(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
