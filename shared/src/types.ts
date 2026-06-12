/** API wire types shared between server and web. */

export type Spec = 'chara_card_v2' | 'chara_card_v3';
export type LorebookOrigin = 'embedded' | 'standalone';

export interface CharacterSummary {
  id: number;
  name: string;
  creator: string;
  tags: string[];
  spec: Spec;
  hasAvatar: boolean;
  hasLorebook: boolean;
  /** Total characters across the card's prompt-relevant text fields. */
  textLength: number;
  createdAt: string;
  updatedAt: string;
  /** Present when the list was produced by a fulltext query. */
  snippet?: string;
}

export interface LorebookRef {
  id: number;
  name: string;
  origin: LorebookOrigin;
  entryCount: number;
}

export interface CharacterDetail extends Omit<CharacterSummary, 'snippet'> {
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  characterVersion: string;
  specVersion: string;
  alternateGreetings: string[];
  lorebooks: LorebookRef[];
  /** Personas connected to this card (owned by the persona side). */
  personas: CharacterPersonaRef[];
  extensions: Record<string, unknown>;
  originalFilename: string;
  originalExt: 'png' | 'json';
}

export interface LorebookSummary {
  id: number;
  name: string;
  origin: LorebookOrigin;
  character: { id: number; name: string } | null;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
  snippet?: string;
}

export interface LorebookEntry {
  id: number;
  positionIdx: number;
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
}

export interface LorebookDetail extends Omit<LorebookSummary, 'snippet'> {
  description: string;
  scanDepth: number | null;
  tokenBudget: number | null;
  recursiveScanning: boolean | null;
  entries: LorebookEntry[];
  extensions: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export type ImportAction =
  | 'imported'
  | 'updated'
  | 'duplicate'
  | 'quarantined'
  | 'removed'
  | 'error';

export interface ImportLogRow {
  id: number;
  at: string;
  path: string;
  kind: 'card' | 'lorebook';
  action: ImportAction;
  detail: string | null;
  entityType: 'character' | 'lorebook' | null;
  entityId: number | null;
}

export interface QuarantineRow {
  id: number;
  path: string;
  kind: 'card' | 'lorebook';
  error: string | null;
  lastProcessedAt: string;
}

export interface KindProgress {
  /** A batch import is currently running for this kind. */
  active: boolean;
  /** Files found in the current (or last finished) batch. */
  total: number;
  processed: number;
  /** Whether the folder watcher is currently running (paused during batches). */
  watching: boolean;
}

export interface ImportStatus {
  card: KindProgress;
  lorebook: KindProgress;
}

export interface Settings {
  watchCardsDir: string;
  watchLorebooksDir: string;
  rescanIntervalSec: number;
  counts: {
    characters: number;
    lorebooks: number;
    quarantined: number;
  };
}

export interface TagCount {
  name: string;
  count: number;
}

// ---------- personas ----------

export interface PersonaGroup {
  id: number;
  name: string;
  /** '#rrggbb' */
  color: string;
}

export interface PersonaGroupWithCount extends PersonaGroup {
  personaCount: number;
}

export interface PersonaSummary {
  id: number;
  name: string;
  hasAvatar: boolean;
  group: PersonaGroup | null;
  characterCount: number;
  /** First part of the markdown description, for list tiles. */
  descriptionSnippet: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaCharacterRef {
  id: number;
  name: string;
  hasAvatar: boolean;
}

export interface PersonaDetail extends PersonaSummary {
  /** Markdown. */
  description: string;
  characters: PersonaCharacterRef[];
}

/** Persona reference shown on the character detail page. */
export interface CharacterPersonaRef {
  id: number;
  name: string;
  hasAvatar: boolean;
  group: { name: string; color: string } | null;
}
