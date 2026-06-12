import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { PersonaDetail } from '@chartreuse/shared';
import { api, personaAvatarUrl } from '../api/client';
import { EmptyState, Monogram } from '../components/ui';
import { RemovablePill } from '../components/filters';
import { MarkdownEditor } from '../components/MarkdownEditor';

interface CharacterRef {
  id: number;
  name: string;
}

export function PersonaEditorPage() {
  const { id } = useParams();
  const isCreate = id === undefined;
  const personaId = isCreate ? null : Number(id);

  const detail = useQuery({
    queryKey: ['persona', personaId],
    queryFn: () => api.persona(personaId!),
    enabled: personaId !== null,
  });

  if (!isCreate && detail.isLoading) return <p className="text-ink-muted">Loading…</p>;
  if (!isCreate && (detail.isError || !detail.data)) {
    return <EmptyState title="Persona not found" hint={String(detail.error ?? '')} />;
  }
  // key remounts the form when navigating between personas
  return <PersonaForm key={personaId ?? 'new'} persona={detail.data ?? null} />;
}

function PersonaForm({ persona }: { persona: PersonaDetail | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(persona?.name ?? '');
  const [description, setDescription] = useState(persona?.description ?? '');
  const [groupId, setGroupId] = useState<number | null>(persona?.group?.id ?? null);
  const [characters, setCharacters] = useState<CharacterRef[]>(persona?.characters ?? []);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const groups = useQuery({ queryKey: ['persona-groups'], queryFn: api.personaGroups });
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#d97757');
  const createGroup = useMutation({
    mutationFn: () => api.createPersonaGroup({ name: newGroupName.trim(), color: newGroupColor }),
    onSuccess: (g) => {
      void queryClient.invalidateQueries({ queryKey: ['persona-groups'] });
      setGroupId(g.id);
      setNewGroupOpen(false);
      setNewGroupName('');
    },
  });

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description,
        groupId,
        characterIds: characters.map((c) => c.id),
      };
      const saved = persona
        ? await api.updatePersona(persona.id, body)
        : await api.createPersona(body);
      if (avatarFile) await api.putPersonaAvatar(saved.id, avatarFile);
      return saved;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['personas'] });
      void queryClient.invalidateQueries({ queryKey: ['persona', saved.id] });
      void queryClient.invalidateQueries({ queryKey: ['persona-groups'] });
      if (persona) setMessage('Saved.');
      else navigate(`/personas/${saved.id}`, { replace: true });
    },
    onError: (err) => setMessage(`Save failed: ${String(err)}`),
  });

  const remove = useMutation({
    mutationFn: () => api.deletePersona(persona!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personas'] });
      navigate('/personas');
    },
  });

  const existingAvatar =
    persona?.hasAvatar && !avatarPreview ? personaAvatarUrl(persona.id, persona.updatedAt) : null;

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside className="space-y-4">
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {avatarPreview ? (
            <img src={avatarPreview} alt="avatar preview" className="aspect-square w-full object-cover" />
          ) : existingAvatar ? (
            <img src={existingAvatar} alt={persona!.name} className="aspect-square w-full object-cover" />
          ) : (
            <Monogram name={name || '?'} className="aspect-square w-full" />
          )}
        </div>
        <label className="block">
          <span className="block cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-center text-sm hover:border-accent/50">
            {avatarFile ? `PNG ready: ${avatarFile.name}` : 'Choose avatar PNG…'}
          </span>
          <input
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setAvatarFile(file);
              setAvatarPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </label>
        {avatarFile && (
          <p className="text-xs text-ink-muted">Uploaded when you save.</p>
        )}

        <div className="space-y-2 rounded-card border border-line bg-surface p-4">
          <span className="block text-xs text-ink-muted">Group</span>
          <select
            value={groupId === null ? '' : String(groupId)}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setNewGroupOpen(true);
              } else {
                setGroupId(e.target.value === '' ? null : Number(e.target.value));
              }
            }}
            className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm"
          >
            <option value="">No group</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="__new__">+ New group…</option>
          </select>
          {newGroupOpen && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="color"
                value={newGroupColor}
                onChange={(e) => setNewGroupColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded-lg border border-line"
              />
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={!newGroupName.trim() || createGroup.isPending}
                onClick={() => createGroup.mutate()}
                className="rounded-lg bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : persona ? 'Save' : 'Create persona'}
          </button>
          {persona && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete persona "${persona.name}"?`)) remove.mutate();
              }}
              className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/10"
            >
              Delete
            </button>
          )}
        </div>
        {message && <p className="text-xs text-ink-muted">{message}</p>}
      </aside>

      <section className="min-w-0 space-y-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Persona name…"
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-display text-xl placeholder:font-sans placeholder:text-base placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
        />

        {/* existing personas open on the rendered preview; new ones start writing */}
        <MarkdownEditor
          value={description}
          onChange={setDescription}
          defaultTab={persona && persona.description.trim() ? 'preview' : 'write'}
        />

        <div className="rounded-card border border-line bg-surface p-4">
          <h2 className="mb-2 font-display">Connected characters</h2>
          <CharacterSuggest
            taken={characters.map((c) => c.id)}
            onAdd={(c) => setCharacters((prev) => [...prev, c])}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {characters.map((c) => (
              <RemovablePill
                key={c.id}
                tag={c.name}
                onRemove={() => setCharacters((prev) => prev.filter((x) => x.id !== c.id))}
              />
            ))}
            {characters.length === 0 && (
              <p className="text-xs text-ink-muted">No characters connected.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function CharacterSuggest({
  taken,
  onAdd,
}: {
  taken: number[];
  onAdd: (c: CharacterRef) => void;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ['character-suggest', debounced],
    queryFn: () =>
      api.characters(
        new URLSearchParams({ q: debounced, fields: 'name', limit: '8' }),
      ),
    enabled: debounced.length > 0,
  });
  const matches = (results.data?.items ?? []).filter((c) => !taken.includes(c.id));

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (c: { id: number; name: string }) => {
    onAdd({ id: c.id, name: c.name });
    setText('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={text}
        placeholder="Search characters by name to connect…"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) pick(matches[0]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
      />
      {open && debounced.length > 0 && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg shadow-ink/10">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span>{c.name}</span>
                {c.creator && <span className="text-xs text-ink-muted">by {c.creator}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
