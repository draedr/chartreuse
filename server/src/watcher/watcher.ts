import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { AppContext } from '../context.js';
import { importFile, markFileRemoved, type ImportKind } from '../importer/importFile.js';
import type { ImportQueue } from '../importer/queue.js';

const YOUNG_FILE_GRACE_MS = 5_000;
const RETRY_DELAY_MS = 5_000;
const MAX_DEPTH = 3;

function isCandidate(filePath: string, kind: ImportKind): boolean {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return false;
  const ext = path.extname(base).toLowerCase();
  return kind === 'card' ? ext === '.png' || ext === '.json' : ext === '.json';
}

/**
 * Polling-based watch service (Docker bind mounts don't propagate inotify) on
 * the two import folders, plus a periodic full rescan as belt-and-braces.
 * All filesystem→db work funnels through the serial ImportQueue.
 */
export class WatchService {
  private watchers: FSWatcher[] = [];
  private rescanTimer: NodeJS.Timeout | null = null;
  private readonly retried = new Set<string>();

  constructor(
    private readonly ctx: AppContext,
    private readonly queue: ImportQueue,
  ) {}

  start(): void {
    const dirs: [string, ImportKind][] = [
      [this.ctx.config.watchCardsDir, 'card'],
      [this.ctx.config.watchLorebooksDir, 'lorebook'],
    ];
    for (const [dir, kind] of dirs) {
      mkdirSync(dir, { recursive: true });
      const watcher = chokidar.watch(dir, {
        usePolling: true,
        interval: 2_000,
        binaryInterval: 3_000,
        awaitWriteFinish: { stabilityThreshold: 1_500, pollInterval: 300 },
        ignoreInitial: false, // initial 'add' events double as the startup scan
        depth: MAX_DEPTH,
      });
      watcher
        .on('add', (p) => this.handleFile(p, kind))
        .on('change', (p) => this.handleFile(p, kind))
        .on('unlink', (p) => {
          if (!isCandidate(p, kind)) return;
          void this.queue.enqueue(() => markFileRemoved(this.ctx.repo, p, kind));
        })
        .on('error', (err) => console.error(`[watcher:${kind}]`, err));
      this.watchers.push(watcher);
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
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.rescanTimer = null;
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }

  /** Applies changed settings live: re-watch the (possibly new) folders. */
  async restart(): Promise<void> {
    await this.close();
    this.start();
    this.requestRescan();
  }

  /** Enqueues a full sweep of both folders + deletion reconciliation. */
  requestRescan(): void {
    const dirs: [string, ImportKind][] = [
      [this.ctx.config.watchCardsDir, 'card'],
      [this.ctx.config.watchLorebooksDir, 'lorebook'],
    ];
    for (const [dir, kind] of dirs) {
      for (const file of walk(dir, MAX_DEPTH)) {
        if (isCandidate(file, kind)) this.handleFile(file, kind);
      }
    }
    // Reconcile deletions: tracked files under the watch roots that vanished.
    void this.queue.enqueue(() => {
      const rows = this.ctx.db
        .prepare("SELECT path, kind FROM import_files WHERE status != 'deleted'")
        .all() as { path: string; kind: ImportKind }[];
      for (const row of rows) {
        const root = row.kind === 'card' ? dirs[0]![0] : dirs[1]![0];
        if (isUnder(row.path, root) && !existsSync(row.path)) {
          markFileRemoved(this.ctx.repo, row.path, row.kind);
        }
      }
    });
  }

  private handleFile(filePath: string, kind: ImportKind, isRetry = false): void {
    if (!isCandidate(filePath, kind)) return;
    void this.queue
      .enqueue(() =>
        importFile({ repo: this.ctx.repo, storage: this.ctx.storage }, filePath, kind, {
          youngFileGraceMs: isRetry ? 0 : YOUNG_FILE_GRACE_MS,
        }),
      )
      .then((res) => {
        if (res.outcome === 'retry' && !this.retried.has(filePath)) {
          // Likely a slow copy; try once more after the grace period.
          this.retried.add(filePath);
          setTimeout(() => this.handleFile(filePath, kind, true), RETRY_DELAY_MS);
          return;
        }
        this.retried.delete(filePath);
        if (res.outcome !== 'skipped') {
          console.log(`[import] ${res.outcome}: ${filePath}${res.error ? ` (${res.error})` : ''}`);
        }
      })
      .catch((err) => console.error(`[import] unexpected failure for ${filePath}:`, err));
  }
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
