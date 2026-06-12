import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LorebookEntry } from '@chartreuse/shared';
import { api, lorebookExportUrl } from '../api/client';
import { Badge, EmptyState, TagChip } from '../components/ui';

export function LorebookDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const lorebookId = Number(id);
  const [filter, setFilter] = useState('');

  const detail = useQuery({
    queryKey: ['lorebook', lorebookId],
    queryFn: () => api.lorebook(lorebookId),
    enabled: Number.isInteger(lorebookId),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteLorebook(lorebookId),
    onSuccess: () => navigate('/lorebooks'),
  });

  const entries = detail.data?.entries ?? [];
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries;
    return entries.filter(
      (e) =>
        e.content.toLowerCase().includes(f) ||
        e.comment.toLowerCase().includes(f) ||
        e.keys.some((k) => k.toLowerCase().includes(f)) ||
        e.secondaryKeys.some((k) => k.toLowerCase().includes(f)),
    );
  }, [entries, filter]);

  if (detail.isLoading) return <p className="text-ink-muted">Loading…</p>;
  if (detail.isError || !detail.data) {
    return <EmptyState title="Lorebook not found" hint={String(detail.error ?? '')} />;
  }
  const lb = detail.data;

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl">{lb.name}</h1>
          <Badge tone={lb.origin === 'standalone' ? 'accent' : 'neutral'}>{lb.origin}</Badge>
          {lb.character && (
            <Link
              to={`/characters/${lb.character.id}`}
              className="text-sm text-accent-deep underline-offset-2 hover:underline"
            >
              character: {lb.character.name}
            </Link>
          )}
          <div className="ml-auto flex gap-2">
            <a
              href={lorebookExportUrl(lb.id)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-deep"
            >
              Export
            </a>
            {lb.origin === 'standalone' && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove lorebook "${lb.name}" from the library?`)) remove.mutate();
                }}
                className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {lb.description && <p className="mt-2 text-sm text-ink-muted">{lb.description}</p>}
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
          <span>{lb.entryCount} entries</span>
          {lb.scanDepth !== null && <span>scan depth {lb.scanDepth}</span>}
          {lb.tokenBudget !== null && <span>token budget {lb.tokenBudget}</span>}
          {lb.recursiveScanning !== null && (
            <span>recursive scanning {lb.recursiveScanning ? 'on' : 'off'}</span>
          )}
        </dl>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Quick filter loaded entries…"
        className="w-full rounded-xl border border-line bg-surface px-4 py-2 text-sm focus:border-accent focus:outline-none"
      />

      <ul className="space-y-2">
        {filtered.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
        {filtered.length === 0 && (
          <EmptyState title="No entries match the filter" />
        )}
      </ul>
    </div>
  );
}

function EntryRow({ entry }: { entry: LorebookEntry }) {
  const [expanded, setExpanded] = useState(false);
  const preview = entry.content.length > 180 && !expanded;
  return (
    <li className="rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-muted">#{entry.positionIdx + 1}</span>
        {entry.keys.map((k) => (
          <TagChip key={`p-${k}`} tag={k} />
        ))}
        {entry.secondaryKeys.map((k) => (
          <span
            key={`s-${k}`}
            className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs text-ink-muted"
          >
            {k}
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">
          {!entry.enabled && <Badge>disabled</Badge>}
          {entry.constant && <Badge tone="accent">constant</Badge>}
          {entry.selective && <Badge>selective</Badge>}
          {entry.insertPosition && <Badge>{entry.insertPosition.replaceAll('_', ' ')}</Badge>}
        </span>
      </div>
      {entry.comment && <p className="mt-1 text-xs italic text-ink-muted">{entry.comment}</p>}
      <p
        className={`mt-1.5 cursor-pointer whitespace-pre-wrap text-sm leading-relaxed ${preview ? 'line-clamp-3' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title={preview ? 'Click to expand' : ''}
      >
        {entry.content}
      </p>
      <div className="mt-1.5 flex gap-4 text-[11px] text-ink-muted">
        <span>order {entry.insertionOrder}</span>
        {entry.probability !== null && <span>probability {entry.probability}%</span>}
        {entry.priority !== null && <span>priority {entry.priority}</span>}
        {entry.sourceUid !== null && <span>uid {entry.sourceUid}</span>}
      </div>
    </li>
  );
}
