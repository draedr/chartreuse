import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { CharacterSummary } from '@chartreuse/shared';
import { api, avatarUrl } from '../api/client';
import { EmptyState, Monogram, Pagination, SearchBar, Snippet, TagChip } from '../components/ui';

function useListParams() {
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page'); // filters reset pagination
    setParams(next, { replace: true });
  };
  return { params, update };
}

export function LibraryPage() {
  const { params, update } = useListParams();
  const q = params.get('q') ?? '';
  const selectedTags = (params.get('tags') ?? '').split(',').filter(Boolean);
  const page = Number(params.get('page') ?? '1');
  const sort = params.get('sort') ?? '';
  const hasLorebook = params.get('has_lorebook') ?? '';
  const creator = params.get('creator') ?? '';

  const queryParams = new URLSearchParams();
  if (q) queryParams.set('q', q);
  if (selectedTags.length > 0) queryParams.set('tags', selectedTags.join(','));
  if (creator) queryParams.set('creator', creator);
  if (hasLorebook) queryParams.set('has_lorebook', hasLorebook);
  if (sort) queryParams.set('sort', sort);
  queryParams.set('page', String(page));
  queryParams.set('limit', '24');

  const list = useQuery({
    queryKey: ['characters', queryParams.toString()],
    queryFn: () => api.characters(queryParams),
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    update({ tags: next.join(',') || null });
  };

  return (
    <div>
      <div className="mb-5 space-y-3">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl">Library</h1>
          <div className="flex-1">
            <SearchBar
              value={q}
              onChange={(v) => update({ q: v || null })}
              placeholder="Search all character fields…"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(tags.data ?? []).slice(0, 16).map((t) => (
            <TagChip
              key={t.name}
              tag={`${t.name} (${t.count})`}
              active={selectedTags.includes(t.name)}
              onClick={() => toggleTag(t.name)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <input
            type="text"
            defaultValue={creator}
            placeholder="creator…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') update({ creator: e.currentTarget.value || null });
            }}
            onBlur={(e) => update({ creator: e.target.value || null })}
            className="w-32 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs focus:border-accent focus:outline-none"
          />
          <select
            value={hasLorebook}
            onChange={(e) => update({ has_lorebook: e.target.value || null })}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
          >
            <option value="">lorebook: any</option>
            <option value="true">has lorebook</option>
            <option value="false">no lorebook</option>
          </select>
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value || null })}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
          >
            <option value="">{q ? 'sort: relevance' : 'sort: name'}</option>
            <option value="name">name</option>
            <option value="created_at">newest import</option>
            <option value="updated_at">recently updated</option>
          </select>
        </div>
      </div>

      {list.isLoading && <p className="text-ink-muted">Loading…</p>}
      {list.isError && <EmptyState title="Could not load the library" hint={String(list.error)} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="No characters found"
          hint="Drop .png or .json cards into the watch folder, or adjust your filters."
        />
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {(list.data?.items ?? []).map((ch) => (
          <CardTile key={ch.id} character={ch} />
        ))}
      </div>

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

function CardTile({ character: ch }: { character: CharacterSummary }) {
  return (
    <Link
      to={`/characters/${ch.id}`}
      className="group overflow-hidden rounded-card border border-line bg-surface transition-shadow hover:shadow-md hover:shadow-ink/5"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-surface-2">
        {ch.hasAvatar ? (
          <img
            src={avatarUrl(ch.id, ch.updatedAt)}
            alt={ch.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <Monogram name={ch.name} className="h-full w-full" />
        )}
        {ch.hasLorebook && (
          <span
            title="Has linked lorebook"
            className="absolute right-2 top-2 rounded-full bg-paper/85 px-1.5 py-0.5 text-xs backdrop-blur"
          >
            📖
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="font-display leading-tight">{ch.name}</p>
        {ch.creator && <p className="text-xs text-ink-muted">by {ch.creator}</p>}
        {ch.snippet && (
          <p className="line-clamp-2 text-xs">
            <Snippet text={ch.snippet} />
          </p>
        )}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {ch.tags.slice(0, 3).map((t) => (
            <TagChip key={t} tag={t} />
          ))}
          {ch.tags.length > 3 && (
            <span className="text-[11px] text-ink-muted">+{ch.tags.length - 3}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
