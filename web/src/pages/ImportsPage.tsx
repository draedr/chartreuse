import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ImportAction } from '@chartreuse/shared';
import { api } from '../api/client';
import { Badge, EmptyState } from '../components/ui';

const ACTION_TONE: Record<ImportAction, 'accent' | 'neutral'> = {
  imported: 'accent',
  updated: 'accent',
  duplicate: 'neutral',
  quarantined: 'neutral',
  removed: 'neutral',
  error: 'neutral',
};

function basename(p: string): string {
  return p.replaceAll('\\', '/').split('/').pop() ?? p;
}

export function ImportsPage() {
  const queryClient = useQueryClient();
  const log = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.imports(new URLSearchParams({ limit: '100' })),
    refetchInterval: 5_000,
  });
  const quarantine = useQuery({
    queryKey: ['quarantine'],
    queryFn: api.quarantine,
    refetchInterval: 5_000,
  });
  const rescan = useMutation({
    mutationFn: api.rescan,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['imports'] }),
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
      <div className="flex items-center gap-4">
        <h1 className="font-display text-2xl">Imports</h1>
        <button
          type="button"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
        >
          {rescan.isPending ? 'Rescanning…' : 'Rescan now'}
        </button>
      </div>

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
        {log.isLoading && <p className="text-ink-muted">Loading…</p>}
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
                  <th className="px-3 py-2 font-normal">action</th>
                  <th className="px-3 py-2 font-normal">file</th>
                  <th className="px-3 py-2 font-normal">detail</th>
                </tr>
              </thead>
              <tbody>
                {log.data.items.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">{row.at}</td>
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
