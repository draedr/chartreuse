import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Badge, EmptyState, Pagination, SearchBar, Snippet } from '../components/ui';

export function LorebooksPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const origin = params.get('origin') ?? '';
  const page = Number(params.get('page') ?? '1');

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const queryParams = new URLSearchParams();
  if (q) queryParams.set('q', q);
  if (origin) queryParams.set('origin', origin);
  queryParams.set('page', String(page));
  queryParams.set('limit', '30');

  const list = useQuery({
    queryKey: ['lorebooks', queryParams.toString()],
    queryFn: () => api.lorebooks(queryParams),
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">Lorebooks</h1>
        <div className="min-w-64 flex-1">
          <SearchBar
            value={q}
            onChange={(v) => update({ q: v || null })}
            placeholder="Search names, entry keys, content…"
          />
        </div>
        <select
          value={origin}
          onChange={(e) => update({ origin: e.target.value || null })}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">origin: all</option>
          <option value="standalone">standalone</option>
          <option value="embedded">embedded</option>
        </select>
      </div>

      {list.isLoading && <p className="text-ink-muted">Loading…</p>}
      {list.isError && <EmptyState title="Could not load lorebooks" hint={String(list.error)} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="No lorebooks found"
          hint="Drop world-info .json files into the lorebook watch folder, or import cards with embedded books."
        />
      )}

      <ul className="space-y-2">
        {(list.data?.items ?? []).map((lb) => (
          <li key={lb.id}>
            <Link
              to={`/lorebooks/${lb.id}`}
              className="block rounded-card border border-line bg-surface px-4 py-3 transition-shadow hover:shadow-md hover:shadow-ink/5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display">📖 {lb.name}</span>
                <Badge tone={lb.origin === 'standalone' ? 'accent' : 'neutral'}>{lb.origin}</Badge>
                <span className="text-xs text-ink-muted">{lb.entryCount} entries</span>
                {lb.character && (
                  <span className="text-xs text-ink-muted">
                    from{' '}
                    <Link
                      to={`/characters/${lb.character.id}`}
                      className="text-accent-deep underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lb.character.name}
                    </Link>
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-muted">updated {lb.updatedAt}</span>
              </div>
              {lb.snippet && (
                <p className="mt-1 line-clamp-2 text-xs">
                  <Snippet text={lb.snippet} />
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {list.data && (
        <Pagination
          page={list.data.page}
          total={list.data.total}
          limit={list.data.limit}
          onPage={(p) => update({ page: String(p) })}
        />
      )}
    </div>
  );
}
