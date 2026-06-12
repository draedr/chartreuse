import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { PersonaGroupWithCount, PersonaSummary } from '@chartreuse/shared';
import { api, personaAvatarUrl } from '../api/client';
import { contrastText, EmptyState, GroupChip, Monogram, Pagination, SearchBar } from '../components/ui';
import { Segmented } from '../components/filters';

type ShowMode = 'both' | 'personas' | 'groups';

export function PersonasPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const groupId = params.get('group_id');
  const sort = params.get('sort') ?? '';
  const page = Number(params.get('page') ?? '1');
  const showParam = params.get('show');
  const show: ShowMode = showParam === 'personas' || showParam === 'groups' ? showParam : 'both';
  const [showGroupManager, setShowGroupManager] = useState(false);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const queryParams = new URLSearchParams();
  if (q) queryParams.set('q', q);
  if (groupId) queryParams.set('group_id', groupId);
  if (sort) queryParams.set('sort', sort);
  queryParams.set('page', String(page));
  queryParams.set('limit', '24');

  const wantPersonas = show !== 'groups';
  const list = useQuery({
    queryKey: ['personas', queryParams.toString()],
    queryFn: () => api.personas(queryParams),
    enabled: wantPersonas,
  });
  const groups = useQuery({ queryKey: ['persona-groups'], queryFn: api.personaGroups });

  // Group folders show in the grid unless searching, inside a group, or personas-only.
  const showFolders = show !== 'personas' && !q && !groupId;
  const activeGroup = groupId
    ? (groups.data ?? []).find((g) => String(g.id) === groupId)
    : undefined;

  return (
    <div>
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl">Personas</h1>
          <div className="min-w-56 flex-1">
            <SearchBar
              value={q}
              onChange={(v) => update({ q: v || null })}
              placeholder="Search persona names and descriptions…"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value || null })}
            className="rounded-lg border border-line bg-surface px-2 py-2 text-sm"
            title="Sort personas"
          >
            <option value="">SORT: name</option>
            <option value="created_at">SORT: created</option>
            <option value="updated_at">SORT: updated</option>
          </select>
          <Segmented
            options={[
              { value: 'both' as ShowMode, label: 'groups & personas' },
              { value: 'personas' as ShowMode, label: 'only personas' },
              { value: 'groups' as ShowMode, label: 'only groups' },
            ]}
            value={show}
            onChange={(v) => update({ show: v === 'both' ? null : v })}
          />
          <button
            type="button"
            onClick={() => setShowGroupManager(true)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-accent/50"
          >
            Manage groups
          </button>
          <Link
            to="/personas/new"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-deep"
          >
            New persona
          </Link>
        </div>

        {activeGroup && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Inside group:</span>
            <GroupChip name={activeGroup.name} color={activeGroup.color} />
            <button
              type="button"
              onClick={() => update({ group_id: null })}
              className="text-accent-deep underline-offset-2 hover:underline"
            >
              ← all personas
            </button>
          </div>
        )}
      </div>

      {/* group folders, part of the grid */}
      {showFolders && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {(groups.data ?? []).map((g) => (
              <GroupFolderTile key={g.id} group={g} onOpen={() => update({ group_id: String(g.id) })} />
            ))}
          </div>
          {(groups.data?.length ?? 0) === 0 && show === 'groups' && (
            <EmptyState title="No groups yet" hint="Create one with the Manage groups button." />
          )}
          {show === 'both' && (
            <hr className="my-5 border-line" />
          )}
        </>
      )}

      {wantPersonas && (
        <>
          {list.isLoading && <p className="text-ink-muted">Loading…</p>}
          {list.isError && <EmptyState title="Could not load personas" hint={String(list.error)} />}
          {list.data && list.data.items.length === 0 && (
            <EmptyState
              title={activeGroup ? 'No personas in this group' : 'No personas yet'}
              hint={activeGroup ? undefined : 'Create your first persona with the New persona button.'}
            />
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {(list.data?.items ?? []).map((p) => (
              <PersonaTile key={p.id} persona={p} />
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
        </>
      )}

      {showGroupManager && <GroupManagerModal onClose={() => setShowGroupManager(false)} />}
    </div>
  );
}

/** Rough plain-text rendering of a markdown snippet for tile previews. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A persona group rendered as a folder-style tile in the grid. */
function GroupFolderTile({
  group,
  onOpen,
}: {
  group: PersonaGroupWithCount;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-card border border-line bg-surface text-left transition-shadow hover:shadow-md hover:shadow-ink/5"
    >
      <div
        className="flex aspect-square items-center justify-center"
        style={{ backgroundColor: `${group.color}22` }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-1/2 w-1/2 transition-transform duration-300 group-hover:scale-[1.06]"
          fill={group.color}
          aria-hidden
        >
          <path d="M3 6a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6L12 6h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
        </svg>
      </div>
      <div className="space-y-1.5 p-3">
        <p className="font-display leading-tight">{group.name}</p>
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[11px]"
          style={{ backgroundColor: group.color, color: contrastText(group.color) }}
        >
          {group.personaCount} persona{group.personaCount === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}

function PersonaTile({ persona: p }: { persona: PersonaSummary }) {
  return (
    <Link
      to={`/personas/${p.id}`}
      className="group overflow-hidden rounded-card border border-line bg-surface transition-shadow hover:shadow-md hover:shadow-ink/5"
    >
      <div className="aspect-square overflow-hidden bg-surface-2">
        {p.hasAvatar ? (
          <img
            src={personaAvatarUrl(p.id, p.updatedAt)}
            alt={p.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <Monogram name={p.name} className="h-full w-full" />
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="font-display leading-tight">{p.name}</p>
        {p.descriptionSnippet.trim() && (
          <p className="line-clamp-2 text-xs text-ink-muted">
            {stripMarkdown(p.descriptionSnippet)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {p.group && <GroupChip name={p.group.name} color={p.group.color} />}
          <span className="text-[11px] text-ink-muted">
            {p.characterCount} character{p.characterCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function GroupManagerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['persona-groups'], queryFn: api.personaGroups });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['persona-groups'] });
    void queryClient.invalidateQueries({ queryKey: ['personas'] });
  };
  const create = useMutation({
    mutationFn: (body: { name: string; color: string }) => api.createPersonaGroup(body),
    onSuccess: invalidate,
  });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#d97757');

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Manage groups">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface shadow-2xl shadow-ink/30">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-lg">Persona groups</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:border-accent/50"
          >
            ×
          </button>
        </header>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">
          {(groups.data ?? []).map((g) => (
            <GroupRow key={g.id} group={g} onChanged={invalidate} />
          ))}
          {(groups.data?.length ?? 0) === 0 && (
            <p className="text-sm text-ink-muted">No groups yet — create one below.</p>
          )}
        </div>
        <footer className="flex items-center gap-2 border-t border-line p-4">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            title="Group color"
            className="h-9 w-9 cursor-pointer rounded-lg border border-line bg-surface"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                create.mutate({ name: newName.trim(), color: newColor });
                setNewName('');
              }
            }}
            className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={!newName.trim() || create.isPending}
            onClick={() => {
              create.mutate({ name: newName.trim(), color: newColor });
              setNewName('');
            }}
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
          >
            Add
          </button>
        </footer>
      </div>
    </div>
  );
}

function GroupRow({
  group,
  onChanged,
}: {
  group: PersonaGroupWithCount;
  onChanged: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const dirty = name.trim() !== group.name || color.toLowerCase() !== group.color;

  const save = useMutation({
    mutationFn: () => api.updatePersonaGroup(group.id, { name: name.trim(), color }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.deletePersonaGroup(group.id),
    onSuccess: onChanged,
  });

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-9 cursor-pointer rounded-lg border border-line bg-surface"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
      <span className="w-16 text-right text-xs text-ink-muted">
        {group.personaCount} persona{group.personaCount === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        disabled={!dirty || !name.trim() || save.isPending}
        onClick={() => save.mutate()}
        className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:border-accent/50 disabled:opacity-40"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          if (
            confirm(
              `Delete group "${group.name}"? Its ${group.personaCount} persona(s) keep working, just ungrouped.`,
            )
          ) {
            remove.mutate();
          }
        }}
        className="rounded-lg border border-danger/40 px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
      >
        Delete
      </button>
    </div>
  );
}
