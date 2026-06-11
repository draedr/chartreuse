import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ImportStatus, KindProgress } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import { sha256 } from '../importer/hash.js';
import { importFile, markFileRemoved, type ImportKind } from '../importer/importFile.js';
import type { ImportQueue } from '../importer/queue.js';

const YOUNG_FILE_GRACE_MS = 5_000;
const RETRY_DELAY_MS = 5_000;
const DISCOVERY_DEBOUNCE_MS = 800;
const MAX_DEPTH = 3;
const KINDS: ImportKind[] = ['card', 'lorebook'];

function isCandidate(filePath: string, kind: ImportKind): boolean {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return false;
  const ext = path.extname(base).toLowerCase();
  return kind === 'card' ? ext === '.png' || ext === '.json' : ext === '.json';
}

interface KindState {
  watcher: FSWatcher | null;
  /** Files discovered but not yet folded into a batch. */
  pending: Set<string>;
  flushTimer: NodeJS.Timeout | null;
  batch: { active: boolean; total: number; processed: number };
}

/**
 * Polling-based watch service (Docker bind mounts don't propagate inotify) on
 * the two import folders, plus a periodic full rescan as belt-and-braces.
 *
 * Discoveries are debounced into per-kind BATCHES: when one or more new files
 * are found, the kind's watcher is PAUSED, the batch size is reported, every
 * file is imported through the serial queue (progress exposed via status()),
 * and the watcher resumes once the batch finishes.
 */
export class WatchService {
  private readonly kinds: Record<ImportKind, KindState> = {
    card: emptyKindState(),
    lorebook: emptyKindState(),
  };
  private rescanTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly queue: ImportQueue,
  ) {}

  start(): void {
    this.closed = false;
    for (const kind of KINDS) {
      if (!this.kinds[kind].batch.active) this.startKind(kind);
    }
    this.rescanTimer = setInterval(
      () => this.requestRescan(),
      this.ctx.config.rescanIntervalSec * 1_000,
    );
    console.log(
      `[watcher] watching cards: ${this.ctx.config.watchCardsDir} | lorebooks: ${this.ctx.config.watchLorebooksDir} (rescan every ${this.ctx.config.rescanIntervalSec}s)`,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.rescanTimer = null;
    for (const kind of KINDS) {
      const st = this.kinds[kind];
      if (st.flushTimer) clearTimeout(st.flushTimer);
      st.flushTimer = null;
      await this.stopKind(kind);
    }
  }

  /** Applies changed settings live: re-watch the (possibly new) folders. */
  async restart(): Promise<void> {
    await this.close();
    this.start();
    this.requestRescan();
  }

  status(): ImportStatus {
    const progress = (kind: ImportKind): KindProgress => {
      const st = this.kinds[kind];
      return {
        active: st.batch.active,
        total: st.batch.total,
        processed: st.batch.processed,
        watching: st.watcher !== null,
      };
    };
    return { card: progress('card'), lorebook: progress('lorebook') };
  }

  /** Sweeps both folders for new files + reconciles deletions. */
  requestRescan(): void {
    for (const kind of KINDS) {
      for (const file of walk(this.dirFor(kind), MAX_DEPTH)) {
        this.discovered(file, kind);
      }
    }
    void this.queue.enqueue(() => {
      const rows = this.ctx.db
        .prepare("SELECT path, kind FROM import_files WHERE status != 'deleted'")
        .all() as { path: string; kind: ImportKind }[];
      for (const row of rows) {
        if (isUnder(row.path, this.dirFor(row.kind)) && !existsSync(row.path)) {
          markFileRemoved(this.ctx.repo, row.path, row.kind);
        }
      }
    });
  }

  /** Single-file import outside batching (quarantine retry). */
  enqueueSingle(filePath: string, kind: ImportKind, force = false): void {
    void this.queue
      .enqueue(() =>
        importFile({ repo: this.ctx.repo, storage: this.ctx.storage }, filePath, kind, {
          force,
        }),
      )
      .then((res) => console.log(`[import] ${res.outcome}: ${filePath}`))
      .catch((err) => console.error(`[import] failed for ${filePath}:`, err));
  }

  // ---------- internals ----------

  private dirFor(kind: ImportKind): string {
    return kind === 'card' ? this.ctx.config.watchCardsDir : this.ctx.config.watchLorebooksDir;
  }

  private startKind(kind: ImportKind): void {
    if (this.closed || this.kinds[kind].watcher) return;
    const dir = this.dirFor(kind);
    mkdirSync(dir, { recursive: true });
    const watcher = chokidar.watch(dir, {
      usePolling: true,
      interval: 2_000,
      binaryInterval: 3_000,
      awaitWriteFinish: { stabilityThreshold: 1_500, pollInterval: 300 },
      ignoreInitial: false, // initial 'add' events double as the startup/resume scan
      depth: MAX_DEPTH,
    });
    watcher
      .on('add', (p) => this.discovered(p, kind))
      .on('change', (p) => this.discovered(p, kind))
      .on('unlink', (p) => {
        if (!isCandidate(p, kind)) return;
        void this.queue.enqueue(() => markFileRemoved(this.ctx.repo, p, kind));
      })
      .on('error', (err) => console.error(`[watcher:${kind}]`, err));
    this.kinds[kind].watcher = watcher;
  }

  private async stopKind(kind: ImportKind): Promise<void> {
    const st = this.kinds[kind];
    const watcher = st.watcher;
    st.watcher = null;
    if (watcher) await watcher.close();
  }

  private discovered(filePath: string, kind: ImportKind): void {
    if (!isCandidate(filePath, kind)) return;
    const st = this.kinds[kind];
    if (st.pending.has(filePath)) return;
    // Pre-filter unchanged files so watcher resumes (which re-emit 'add' for
    // everything) don't form pointless batches.
    if (!this.wouldImport(filePath)) return;
    st.pending.add(filePath);
    this.scheduleFlush(kind);
  }

  /** Cheap pre-check mirroring importFile's skip rule (authoritative check
   *  still happens inside the queue). */
  private wouldImport(filePath: string): boolean {
    try {
      const fileHash = sha256(readFileSync(filePath));
      const prior = this.ctx.repo.getImportFile(filePath);
      return !(prior && prior.file_hash === fileHash);
    } catch {
      return false; // unreadable/vanished — let the next event try again
    }
  }

  private scheduleFlush(kind: ImportKind): void {
    const st = this.kinds[kind];
    if (st.flushTimer) clearTimeout(st.flushTimer);
    st.flushTimer = setTimeout(() => this.flush(kind), DISCOVERY_DEBOUNCE_MS);
  }

  private flush(kind: ImportKind): void {
    const st = this.kinds[kind];
    if (st.batch.active || st.pending.size === 0) return; // re-flushed at batch end
    const paths = [...st.pending];
    st.pending.clear();
    st.batch = { active: true, total: paths.length, processed: 0 };
    console.log(`[import] found ${paths.length} ${kind} file(s) — watcher paused for the batch`);
    void this.stopKind(kind);

    for (const p of paths) {
      void this.queue
        .enqueue(() =>
          importFile({ repo: this.ctx.repo, storage: this.ctx.storage }, p, kind, {
            youngFileGraceMs: YOUNG_FILE_GRACE_MS,
          }),
        )
        .then((res) => {
          if (res.outcome === 'retry') {
            // Likely a slow copy; feed it back into discovery after the grace
            // period (it will quarantine once its mtime is no longer fresh).
            setTimeout(() => this.discovered(p, kind), RETRY_DELAY_MS);
          } else if (res.outcome !== 'skipped') {
            console.log(`[import] ${res.outcome}: ${p}${res.error ? ` (${res.error})` : ''}`);
          }
        })
        .catch((err) => console.error(`[import] unexpected failure for ${p}:`, err))
        .finally(() => {
          st.batch.processed += 1;
          if (st.batch.processed >= st.batch.total) this.endBatch(kind);
        });
    }
  }

  private endBatch(kind: ImportKind): void {
    const st = this.kinds[kind];
    st.batch.active = false;
    console.log(
      `[import] ${kind} batch finished (${st.batch.processed}/${st.batch.total}) — watcher resumed`,
    );
    this.startKind(kind);
    if (st.pending.size > 0) this.scheduleFlush(kind); // discoveries made during the batch
  }
}

function emptyKindState(): KindState {
  return {
    watcher: null,
    pending: new Set(),
    flushTimer: null,
    batch: { active: false, total: 0, processed: 0 },
  };
}

function* walk(dir: string, depth: number): Generator<string> {
  if (depth < 0 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p, depth - 1);
    else if (entry.isFile()) yield p;
  }
}

function isUnder(filePath: string, root: string): boolean {
  const rel = path.relative(root, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
