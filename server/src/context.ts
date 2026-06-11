import type { Db } from './db/connection.js';
import type { Storage } from './files/storage.js';
import type { Config } from './config.js';
import type { Repository } from './importer/repository.js';

/** Shared wiring passed to API routes, importer and watcher. */
export interface AppContext {
  db: Db;
  storage: Storage;
  config: Config;
  repo: Repository;
  /** Set once the watcher is running; lets settings routes apply changes live. */
  onSettingsChanged?: () => Promise<void>;
  /** Enqueue a full rescan of both watch folders. */
  requestRescan?: () => void;
  /** Enqueue a single file import (quarantine retry). */
  enqueueImport?: (path: string, kind: 'card' | 'lorebook', force?: boolean) => void;
  /** Current per-kind batch progress + watcher state. */
  getImportStatus?: () => import('@chartreuse/shared').ImportStatus;
}
