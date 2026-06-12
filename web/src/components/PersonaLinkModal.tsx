import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, personaAvatarUrl } from '../api/client';
import { GroupChip, Monogram, SearchBar } from './ui';

/**
 * Connect/disconnect personas for one character. Writes go through the
 * persona-side endpoints — the connection stays owned by the persona.
 */
export function PersonaLinkModal({
  characterId,
  characterName,
  linkedIds,
  onClose,
}: {
  characterId: number;
  characterName: string;
  linkedIds: number[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const params = new URLSearchParams({ limit: '100' });
  if (q) params.set('q', q);
  const personas = useQuery({
    queryKey: ['personas', 'link-modal', q],
    queryFn: () => api.personas(params),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['character', characterId] });
    void queryClient.invalidateQueries({ queryKey: ['personas'] });
  };
  const link = useMutation({
    mutationFn: (personaId: number) => api.linkPersonaCharacter(personaId, characterId),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: (personaId: number) => api.unlinkPersonaCharacter(personaId, characterId),
    onSuccess: invalidate,
  });

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Link personas">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[min(36rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-2xl shadow-ink/30">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate font-display text-lg">
            Link personas to {characterName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted hover:border-accent/50"
          >
            ×
          </button>
        </header>
        <div className="border-b border-line p-3">
          <SearchBar value={q} onChange={setQ} placeholder="Search personas…" autoFocus />
        </div>
        <ul className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {personas.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {(personas.data?.items ?? []).map((p) => {
            const connected = linkedIds.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2">
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2">
                  {p.hasAvatar ? (
                    <img
                      src={personaAvatarUrl(p.id, p.updatedAt)}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Monogram name={p.name} className="h-full w-full [&>span]:text-sm" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                {p.group && <GroupChip dot name={p.group.name} color={p.group.color} />}
                {connected ? (
                  <button
                    type="button"
                    onClick={() => unlink.mutate(p.id)}
                    className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs text-danger hover:bg-danger/10"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => link.mutate(p.id)}
                    className="rounded-lg bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-deep"
                  >
                    Connect
                  </button>
                )}
              </li>
            );
          })}
          {personas.data && personas.data.items.length === 0 && (
            <p className="text-sm text-ink-muted">
              No personas{q ? ' match the search' : ' yet — create one on the Personas page'}.
            </p>
          )}
        </ul>
      </div>
    </div>
  );
}
