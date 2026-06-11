/**
 * Serial FIFO — the only writer path into the importer. Each job runs in its
 * own macrotask (setImmediate), so HTTP requests interleave between the fast,
 * synchronous better-sqlite3 imports even during bulk drops.
 */
export class ImportQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;

  enqueue<T>(job: () => T): Promise<T> {
    this.pending += 1;
    const next = this.chain.then(
      () =>
        new Promise<T>((resolve, reject) => {
          setImmediate(() => {
            try {
              resolve(job());
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            } finally {
              this.pending -= 1;
            }
          });
        }),
    );
    // The chain must survive rejected jobs.
    this.chain = next.catch(() => undefined);
    return next;
  }

  get size(): number {
    return this.pending;
  }
}
