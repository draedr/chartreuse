import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { CharacterSummary } from '@chartreuse/shared';
import { api, avatarUrl } from '../api/client';
import {
  EmptyState,
  Monogram,
  Pagination,
  SearchBar,
  Snippet,
  TagChip,
  ViewToggle,
  useViewMode,
} from '../components/ui';
import {
  CommitNumberInput,
  FieldsDropdown,
  RemovablePill,
  Segmented,
  TagSuggest,
} from '../components/filters';

const SEARCHABLE_FIELDS = [
  'name', 'creator', 'tags', 'description', 'personality', 'scenario',
  'first_mes', 'mes_example', 'alternate_greetings', 'creator_notes',
  'system_prompt', 'post_history_instructions',
] as const;

const csv = (s: string | null): string[] => (s ?? '').split(',').filter(Boolean);

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? '';
  const tags = csv(params.get('tags'));
  const excludeTags = csv(params.get('exclude_tags'));
  const tagsMode = params.get('tags_mode') === 'any' ? 'any' : 'all';
  const hasLorebook = params.get('has_lorebook') ?? ''; // '' | 'true' | 'false'
  const minLength = params.get('min_length') ?? '';
  const maxLength = params.get('max_length') ?? '';
  const fields = csv(params.get('fields'));
  const page = Number(params.get('page') ?? '1');

  // Base every update on window.location (updated synchronously by replaceState)
  // rather than the render snapshot or router state: rapid successive updates
  // (e.g. removing several pills at once) must compose, not last-write-win.
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page'); // filter changes reset pagination
    setParams(next, { replace: true });
  };

  const queryParams = new URLSearchParams();
  if (q) queryParams.set('q', q);
  if (fields.length > 0) queryParams.set('fields', fields.join(','));
  if (tags.length > 0) queryParams.set('tags', tags.join(','));
  if (excludeTags.length > 0) queryParams.set('exclude_tags', excludeTags.join(','));
  if (tagsMode === 'any') queryParams.set('tags_mode', 'any');
  if (hasLorebook) queryParams.set('has_lorebook', hasLorebook);
  if (minLength) queryParams.set('min_length', minLength);
  if (maxLength) queryParams.set('max_length', maxLength);
  if (sort) queryParams.set('sort', sort);
  queryParams.set('page', String(page));
  queryParams.set('limit', '24');

  const list = useQuery({
    queryKey: ['characters', queryParams.toString()],
    queryFn: () => api.characters(queryParams),
  });
  const allTags = useQuery({ queryKey: ['tags'], queryFn: api.tags });
  const takenTags = [...tags, ...excludeTags];
  const [view, setView] = useViewMode('chartreuse-view-characters', 'grid');

  const editList = (key: 'tags' | 'exclude_tags', fn: (list: string[]) => string[]) => {
    const current = new URLSearchParams(window.location.search);
    update({ [key]: fn(csv(current.get(key))).join(',') || null });
  };
  const addTo = (key: 'tags' | 'exclude_tags', tag: string) =>
    editList(key, (list) => (list.includes(tag) ? list : [...list, tag]));
  const removeFrom = (key: 'tags' | 'exclude_tags', tag: string) =>
    editList(key, (list) => list.filter((x) => x !== tag));

  return (
    <div>
      <div className="mb-4 space-y-3">
        {/* main filter line: search · sort · tag suggest */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl">Library</h1>
          <div className="min-w-56 flex-1">
            <SearchBar
              value={q}
              onChange={(v) => update({ q: v || null })}
              placeholder="Search all character fields…"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value || null })}
            className="rounded-xl border border-line bg-surface px-2.5 py-2.5 text-sm"
            title="Sort results"
          >
            <option value="">{q ? 'SORT: relevance' : 'SORT: recently updated'}</option>
            <option value="name">SORT: name</option>
            <option value="created_at">SORT: newest import</option>
            <option value="updated_at">SORT: recently updated</option>
            <option value="text_length">SORT: card length</option>
          </select>
          <div className="w-56">
            <TagSuggest
              options={allTags.data ?? []}
              taken={takenTags}
              onAdd={(t) => addTo('tags', t)}
              placeholder="Filter by tag…"
            />
          </div>
          <ViewToggle mode={view} onChange={setView} />
        </div>

        {/* active tag pills */}
        {(tags.length > 0 || excludeTags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <RemovablePill key={t} tag={t} onRemove={() => removeFrom('tags', t)} />
            ))}
            {excludeTags.map((t) => (
              <RemovablePill
                key={`x-${t}`}
                tag={t}
                excluded
                onRemove={() => removeFrom('exclude_tags', t)}
              />
            ))}
            {tags.length > 1 && (
              <span className="text-[11px] text-ink-muted">
                ({tagsMode === 'all' ? 'all must match' : 'any matches'})
              </span>
            )}
          </div>
        )}

        {/* advanced filters, collapsed by default */}
        <details className="rounded-card border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-muted hover:text-ink">
            Advanced filters
          </summary>
          <fieldset className="grid gap-x-8 gap-y-4 border-t border-line px-4 py-4 text-sm sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-xs text-ink-muted">Lorebook</span>
              <Segmented
                options={[
                  { value: 'true', label: 'must have lorebook' },
                  { value: '', label: 'no filter' },
                  { value: 'false', label: 'must not have lorebook' },
                ]}
                value={hasLorebook as '' | 'true' | 'false'}
                onChange={(v) => update({ has_lorebook: v || null })}
              />
            </label>

            <label className="space-y-1.5">
              <span className="block text-xs text-ink-muted">Tag matching (for included tags)</span>
              <Segmented
                options={[
                  { value: 'all', label: 'all tags must correspond' },
                  { value: 'any', label: 'any tag should correspond' },
                ]}
                value={tagsMode}
                onChange={(v) => update({ tags_mode: v === 'any' ? 'any' : null })}
              />
            </label>

            <div className="space-y-1.5">
              <span className="block text-xs text-ink-muted">Exclude tags</span>
              <TagSuggest
                options={allTags.data ?? []}
                taken={takenTags}
                onAdd={(t) => addTo('exclude_tags', t)}
                placeholder="Exclude cards with tag…"
              />
            </div>

            <label className="space-y-1.5">
              <span className="block text-xs text-ink-muted">
                Card length (total characters of card text)
              </span>
              <span className="flex items-center gap-2">
                <CommitNumberInput
                  value={minLength}
                  onCommit={(v) => update({ min_length: v || null })}
                  placeholder="min"
                />
                <span className="text-ink-muted">–</span>
                <CommitNumberInput
                  value={maxLength}
                  onCommit={(v) => update({ max_length: v || null })}
                  placeholder="max"
                />
              </span>
            </label>

            <div className="space-y-1.5">
              <span className="block text-xs text-ink-muted">Fulltext search scope</span>
              <FieldsDropdown
                allFields={SEARCHABLE_FIELDS}
                selected={fields}
                onChange={(next) => update({ fields: next.join(',') || null })}
              />
            </div>

            <label className="space-y-1.5">
              <span className="block text-xs text-ink-muted">Creator</span>
              <input
                type="text"
                defaultValue={params.get('creator') ?? ''}
                placeholder="exact creator name…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') update({ creator: e.currentTarget.value || null });
                }}
                onBlur={(e) => update({ creator: e.target.value || null })}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none"
              />
            </label>
          </fieldset>
        </details>
      </div>

      {list.isLoading && <p className="text-ink-muted">Loading…</p>}
      {list.isError && <EmptyState title="Could not load the library" hint={String(list.error)} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="No characters found"
          hint="Drop .png or .json cards into the watch folder, or adjust your filters."
        />
      )}

      {view === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {(list.data?.items ?? []).map((ch) => (
            <CardTile key={ch.id} character={ch} />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {(list.data?.items ?? []).map((ch) => (
            <CardRow key={ch.id} character={ch} />
          ))}
        </ul>
      )}

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

function formatLength(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function CardRow({ character: ch }: { character: CharacterSummary }) {
  return (
    <li>
      <Link
        to={`/characters/${ch.id}`}
        className="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-2.5 transition-shadow hover:shadow-md hover:shadow-ink/5"
      >
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
          {ch.hasAvatar ? (
            <img
              src={avatarUrl(ch.id, ch.updatedAt)}
              alt={ch.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <Monogram name={ch.name} className="h-full w-full [&>span]:text-xl" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display leading-tight">{ch.name}</p>
          <p className="text-xs text-ink-muted">
            {ch.creator ? `by ${ch.creator} · ` : ''}
            {formatLength(ch.textLength)} chars
            {ch.hasLorebook ? ' · has lorebook' : ''}
          </p>
          {ch.snippet && (
            <p className="truncate text-xs">
              <Snippet text={ch.snippet} />
            </p>
          )}
        </div>
        <div className="hidden flex-wrap justify-end gap-1 sm:flex">
          {ch.tags.slice(0, 4).map((t) => (
            <TagChip key={t} tag={t} />
          ))}
          {ch.tags.length > 4 && (
            <span className="text-[11px] text-ink-muted">+{ch.tags.length - 4}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function CardTile({ character: ch }: { character: CharacterSummary }) {
  // The creator filter lives in advanced filters; tile shows creator + length.
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
        <p className="text-xs text-ink-muted">
          {ch.creator ? `by ${ch.creator} · ` : ''}
          {formatLength(ch.textLength)} chars
        </p>
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
