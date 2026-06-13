import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Storage } from '../files/storage.js';
import { sha256, hashPayload } from './hash.js';
import {
  normalizeCharacter,
  normalizeLorebook,
  type NormalizedCharacter,
  type NormalizedLorebook,
} from './normalize.js';
import { readCardPayload } from './pngText.js';
import { Repository } from './repository.js';

export type ImportKind = 'card' | 'lorebook';

/** 'skipped' (unchanged file) and 'retry' (young file mid-copy) are internal —
 *  they are never written to the import log. */
export type ImportOutcome =
  | 'imported'
  | 'updated'
  | 'duplicate'
  | 'quarantined'
  | 'error'
  | 'skipped'
  | 'retry';

export interface ImportResult {
  outcome: ImportOutcome;
  entityType?: 'character' | 'lorebook';
  entityId?: number;
  error?: string;
}

export interface ImportDeps {
  repo: Repository;
  storage: Storage;
}

export interface ImportOptions {
  /** If parsing fails and the file was modified within this window, return
   *  'retry' instead of quarantining (slow copies into the watch folder). */
  youngFileGraceMs?: number;
  /** Process the file even if its bytes are unchanged since the last attempt
   *  (used by the quarantine-retry endpoint). */
  force?: boolean;
  /** Insert a new card even when another card has the same extracted payload.
   *  Frontend uploads dedup on the whole file instead, so a different image
   *  carrying the same card should still become a separate card. */
  allowDuplicateSource?: boolean;
}

export function importFile(
  deps: ImportDeps,
  absPath: string,
  kind: ImportKind,
  opts: ImportOptions = {},
): ImportResult {
  const { repo, storage } = deps;
  const filename = path.basename(absPath);

  let bytes: Buffer;
  try {
    bytes = readFileSync(absPath);
  } catch (err) {
    return { outcome: 'error', error: `cannot read file: ${message(err)}` };
  }
  const fileHash = sha256(bytes);

  // Unchanged bytes never re-process (also for quarantined files — retrying the
  // identical bytes is pointless and would loop on every watcher resume; the
  // quarantine-retry endpoint passes force instead).
  const prior = repo.getImportFile(absPath);
  if (prior && prior.file_hash === fileHash && !opts.force) {
    return { outcome: 'skipped' };
  }

  // ---- parse + normalize; failures here quarantine the file ----
  let parsed:
    | { kind: 'card'; norm: NormalizedCharacter; ext: 'png' | 'json' }
    | { kind: 'lorebook'; norm: NormalizedLorebook };
  try {
    if (kind === 'card') {
      const ext = filename.toLowerCase().endsWith('.png') ? 'png' : 'json';
      const payloadText = ext === 'png' ? readCardPayload(bytes) : bytes.toString('utf8');
      const payload: unknown = JSON.parse(payloadText);
      parsed = { kind: 'card', norm: normalizeCharacter(payload), ext };
    } else {
      const payload: unknown = JSON.parse(bytes.toString('utf8'));
      const fallbackName = filename.replace(/\.[^.]+$/, '');
      parsed = { kind: 'lorebook', norm: normalizeLorebook(payload, fallbackName) };
    }
  } catch (err) {
    if (opts.youngFileGraceMs) {
      try {
        const ageMs = Date.now() - statSync(absPath).mtimeMs;
        if (ageMs < opts.youngFileGraceMs) return { outcome: 'retry' };
      } catch {
        // stat failed (file vanished mid-import) — fall through to quarantine
      }
    }
    return quarantine(deps, absPath, kind, fileHash, message(err));
  }

  let sourceHash = hashPayload(parsed.norm.raw);
  // Uploads dedup on the whole file, not the payload, but characters.source_hash
  // is UNIQUE. When a separate-card upload carries a payload that already exists,
  // salt its source_hash with the (unique) file hash so it inserts cleanly as a
  // distinct card instead of violating the constraint.
  if (
    parsed.kind === 'card' &&
    opts.allowDuplicateSource &&
    repo.findCharacterIdByHash(sourceHash) !== undefined
  ) {
    sourceHash = sha256(`${fileHash}:${sourceHash}`);
  }

  // ---- transactional upsert; failures here are logged as errors ----
  try {
    return repo.transaction(() => {
      if (parsed.kind === 'card') {
        return upsertCharacter(deps, absPath, filename, bytes, fileHash, sourceHash, parsed.norm, parsed.ext, prior, opts);
      }
      return upsertLorebook(deps, absPath, filename, bytes, fileHash, sourceHash, parsed.norm, prior);
    });
  } catch (err) {
    const error = message(err);
    repo.appendLog({ path: absPath, kind, action: 'error', detail: error, entityType: null, entityId: null });
    return { outcome: 'error', error };
  }
}

/**
 * Frontend card upload: saves the file into the watched cards folder and
 * imports it. Dedup is on the whole file (image + embedded card) — a
 * byte-identical upload is skipped as a 'duplicate'; anything else becomes a
 * separate card (even if it carries the same payload as an existing one).
 *
 * Run this through the import queue so it serializes with the watcher; once
 * the file lands in the folder the watcher will see it already imported (its
 * import_files row matches) and leave it alone.
 */
export function importUploadedCard(
  deps: ImportDeps,
  cardsDir: string,
  filename: string,
  bytes: Buffer,
): ImportResult {
  const lower = filename.toLowerCase();
  const ext = lower.endsWith('.png') ? 'png' : lower.endsWith('.json') ? 'json' : null;
  if (!ext) {
    return { outcome: 'error', error: 'unsupported file type (expected .png or .json)' };
  }

  // Reject non-cards before writing anything into the watched folder.
  try {
    const payloadText = ext === 'png' ? readCardPayload(bytes) : bytes.toString('utf8');
    normalizeCharacter(JSON.parse(payloadText));
  } catch (err) {
    return { outcome: 'error', error: `not a valid character card: ${message(err)}` };
  }

  const fileHash = sha256(bytes);
  const dupId = deps.repo.findCharacterIdByOriginalHash(fileHash);
  if (dupId !== undefined) {
    return { outcome: 'duplicate', entityType: 'character', entityId: dupId };
  }

  mkdirSync(cardsDir, { recursive: true });
  const dest = uniqueDestPath(cardsDir, filename);
  try {
    writeFileSync(dest, bytes);
  } catch (err) {
    return { outcome: 'error', error: `cannot save file: ${message(err)}` };
  }
  return importFile(deps, dest, 'card', { allowDuplicateSource: true });
}

/** A non-colliding path in `dir` for `filename`, sanitized and de-duped with
 *  a " (n)" suffix so distinct uploads never overwrite each other. */
function uniqueDestPath(dir: string, filename: string): string {
  const safe =
    path.basename(filename).replace(/[/\\<>:"|?*]/g, '_').trim() || 'card.png';
  let candidate = path.join(dir, safe);
  if (!existsSync(candidate)) return candidate;
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let n = 1;
  do {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  } while (existsSync(candidate));
  return candidate;
}

function upsertCharacter(
  { repo, storage }: ImportDeps,
  absPath: string,
  filename: string,
  bytes: Buffer,
  fileHash: string,
  sourceHash: string,
  norm: NormalizedCharacter,
  ext: 'png' | 'json',
  prior: ReturnType<Repository['getImportFile']>,
  opts: ImportOptions,
): ImportResult {
  const meta = {
    sourceHash,
    originalHash: fileHash,
    originalExt: ext,
    originalFilename: filename,
    hasAvatar: ext === 'png',
  };
  const existingId = opts.allowDuplicateSource
    ? undefined
    : repo.findCharacterIdByHash(sourceHash);

  let outcome: 'imported' | 'updated' | 'duplicate';
  let id: number;
  if (existingId !== undefined) {
    outcome = 'duplicate';
    id = existingId;
  } else if (
    prior &&
    prior.entity_type === 'character' &&
    prior.entity_id !== null &&
    prior.status !== 'quarantined'
  ) {
    // Same watched file, new payload: the file was edited in place.
    outcome = 'updated';
    id = prior.entity_id;
    repo.updateCharacter(id, norm, meta);
  } else {
    outcome = 'imported';
    id = repo.insertCharacter(norm, meta);
  }

  storage.storeOriginal(fileHash, ext, bytes);
  if (ext === 'png' && outcome !== 'duplicate') storage.storeAvatar(id, bytes);

  repo.upsertImportFile({
    path: absPath, kind: 'card', fileHash, sourceHash,
    entityType: 'character', entityId: id, status: outcome, error: null,
  });
  repo.appendLog({
    path: absPath, kind: 'card', action: outcome,
    detail: norm.name, entityType: 'character', entityId: id,
  });
  return { outcome, entityType: 'character', entityId: id };
}

function upsertLorebook(
  { repo, storage }: ImportDeps,
  absPath: string,
  filename: string,
  bytes: Buffer,
  fileHash: string,
  sourceHash: string,
  norm: NormalizedLorebook,
  prior: ReturnType<Repository['getImportFile']>,
): ImportResult {
  const meta = {
    sourceHash,
    origin: 'standalone' as const,
    characterId: null,
    originalHash: fileHash,
    originalFilename: filename,
  };
  const existingId = repo.findLorebookIdByHash(sourceHash);

  let outcome: 'imported' | 'updated' | 'duplicate';
  let id: number;
  if (existingId !== undefined) {
    outcome = 'duplicate';
    id = existingId;
  } else if (
    prior &&
    prior.entity_type === 'lorebook' &&
    prior.entity_id !== null &&
    prior.status !== 'quarantined'
  ) {
    outcome = 'updated';
    id = prior.entity_id;
    repo.updateLorebook(id, norm, meta);
  } else {
    outcome = 'imported';
    id = repo.insertLorebook(norm, meta);
  }

  storage.storeOriginal(fileHash, 'json', bytes);

  repo.upsertImportFile({
    path: absPath, kind: 'lorebook', fileHash, sourceHash,
    entityType: 'lorebook', entityId: id, status: outcome, error: null,
  });
  repo.appendLog({
    path: absPath, kind: 'lorebook', action: outcome,
    detail: norm.name, entityType: 'lorebook', entityId: id,
  });
  return { outcome, entityType: 'lorebook', entityId: id };
}

function quarantine(
  { repo, storage }: ImportDeps,
  absPath: string,
  kind: ImportKind,
  fileHash: string,
  error: string,
): ImportResult {
  const detail = error.slice(0, 500);
  try {
    storage.quarantine(absPath);
  } catch {
    // file vanished or copy failed; still record the failure
  }
  repo.upsertImportFile({
    path: absPath, kind, fileHash, sourceHash: null,
    entityType: null, entityId: null, status: 'quarantined', error: detail,
  });
  repo.appendLog({
    path: absPath, kind, action: 'quarantined',
    detail, entityType: null, entityId: null,
  });
  return { outcome: 'quarantined', error: detail };
}

/** Marks a watch-folder file as gone. The entity is kept: the folder is an
 *  inbox, the library is the source of truth. */
export function markFileRemoved(repo: Repository, absPath: string, kind: ImportKind): void {
  if (repo.markFileDeleted(absPath)) {
    repo.appendLog({
      path: absPath, kind, action: 'removed',
      detail: null, entityType: null, entityId: null,
    });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
