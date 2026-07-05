import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { ImportAction, KindProgress } from '@chartreuse/shared';
import { api } from '../api/client';
import { Badge, EmptyState, LoadingState } from '../components/ui';

const ACTION_TONE: Record<ImportAction, 'accent' | 'neutral'> = {
  imported: 'accent',
  updated: 'accent',
  duplicate: 'neutral',
  quarantined: 'neutral',
  removed: 'neutral',
  error: 'neutral',
};

type KindFilter = 'both' | 'card' | 'lorebook';

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'card', label: 'Character cards' },
  { value: 'lorebook', label: 'Lorebooks' },
];

function basename(p: string): string {
  return p.replaceAll('\\', '/').split('/').pop() ?? p;
}

export function ImportsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('kind');
  const kind: KindFilter = kindParam === 'card' || kindParam === 'lorebook' ? kindParam : 'both';
  const apiKind = kind === 'both' ? undefined : kind;

  const setKind = (next: KindFilter) => {
    const p = new URLSearchParams(params);
    if (next === 'both') p.delete('kind');
    else p.set('kind', next);
    setParams(p, { replace: true });
  };

  const status = useQuery({
    queryKey: ['import-status'],
    queryFn: api.importStatus,
    refetchInterval: (q) =>
      q.state.data && (q.state.data.card.active || q.state.data.lorebook.active) ? 1_000 : 2_000,
  });
  const importing = status.data?.card.active || status.data?.lorebook.active;

  const logParams = new URLSearchParams({ limit: '100' });
  if (apiKind) logParams.set('kind', apiKind);
  const log = useQuery({
    queryKey: ['imports', apiKind ?? 'both'],
    queryFn: () => api.imports(logParams),
    refetchInterval: importing ? 1_500 : 5_000,
  });
  const quarantine = useQuery({
    queryKey: ['quarantine', apiKind ?? 'both'],
    queryFn: () => api.quarantine(apiKind),
    refetchInterval: 5_000,
  });

  const rescan = useMutation({
    mutationFn: api.rescan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['import-status'] });
    },
  });
  const retry = useMutation({
    mutationFn: (id: number) => api.retryQuarantine(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-display text-2xl">Imports</h1>
        <div className="flex overflow-hidden rounded-lg border border-line text-sm" role="group">
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKind(opt.value)}
              className={`px-3 py-1.5 transition-colors ${
                kind === opt.value
                  ? 'bg-accent-soft text-accent-deep'
                  : 'bg-surface text-ink-muted hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
        >
          {rescan.isPending ? 'Rescanning…' : 'Rescan now'}
        </button>
      </div>

      {status.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(kind === 'both' || kind === 'card') && (
            <ProgressCard label="Character cards" progress={status.data.card} />
          )}
          {(kind === 'both' || kind === 'lorebook') && (
            <ProgressCard label="Lorebooks" progress={status.data.lorebook} />
          )}
        </div>
      )}

      {(quarantine.data?.length ?? 0) > 0 && (
        <section className="rounded-card border border-danger/30 bg-surface p-4">
          <h2 className="mb-2 font-display text-lg">Quarantine</h2>
          <ul className="space-y-2 text-sm">
            {quarantine.data!.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs" title={row.path}>
                  {basename(row.path)}
                </span>
                <Badge>{row.kind}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-danger" title={row.error ?? ''}>
                  {row.error}
                </span>
                <button
                  type="button"
                  onClick={() => retry.mutate(row.id)}
                  className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent/50"
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-lg">Activity log</h2>
        {log.isLoading && <LoadingState />}
        {log.data && log.data.items.length === 0 && (
          <EmptyState
            title="Nothing imported yet"
            hint="Drop character cards or lorebooks into the watch folders — they show up here automatically."
          />
        )}
        {log.data && log.data.items.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-normal">time</th>
                  <th className="px-3 py-2 font-normal">kind</th>
                  <th className="px-3 py-2 font-normal">action</th>
                  <th className="px-3 py-2 font-normal">file</th>
                  <th className="px-3 py-2 font-normal">detail</th>
                </tr>
              </thead>
              <tbody>
                {log.data.items.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">{row.at}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {row.kind === 'card' ? '🃏 card' : '📖 lorebook'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ACTION_TONE[row.action]}>{row.action}</Badge>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 font-mono text-xs" title={row.path}>
                      {basename(row.path)}
                    </td>
                    <td className="max-w-64 truncate px-3 py-2 text-xs text-ink-muted">
                      {row.entityType && row.entityId !== null ? (
                        <Link
                          to={
                            row.entityType === 'character'
                              ? `/characters/${row.entityId}`
                              : `/lorebooks/${row.entityId}`
                          }
                          className="text-accent-deep underline-offset-2 hover:underline"
                        >
                          {row.detail}
                        </Link>
                      ) : (
                        row.detail
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ProgressCard({ label, progress }: { label: string; progress: KindProgress }) {
  const pct =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-display">{label}</span>
        {progress.active ? (
          <span className="text-accent-deep">
            importing {progress.processed} / {progress.total}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">
            {progress.watching ? 'watching for new files' : 'watcher paused'}
            {progress.total > 0 && ` · last batch: ${progress.total} file(s)`}
          </span>
        )}
      </div>
      {progress.active && (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            found {progress.total} file(s) — watching is paused until the batch finishes
          </p>
        </>
      )}
    </div>
  );
}
