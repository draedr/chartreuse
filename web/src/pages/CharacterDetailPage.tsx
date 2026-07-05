import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CharacterDetail } from '@chartreuse/shared';
import {
  api,
  avatarUrl,
  characterExportUrl,
  chatDownloadUrl,
  personaAvatarUrl,
} from '../api/client';
import { Badge, EmptyState, GroupChip, LoadingState, Monogram, TagChip } from '../components/ui';
import { Segmented } from '../components/filters';
import { RichText, useRenderHtml } from '../components/RichText';
import { JsonModal } from '../components/JsonModal';
import { PersonaLinkModal } from '../components/PersonaLinkModal';

const FIELD_SECTIONS: { key: keyof CharacterDetail; label: string }[] = [
  { key: 'creatorNotes', label: 'Creator Notes' },
  { key: 'description', label: 'Description' },
  { key: 'personality', label: 'Personality' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'firstMes', label: 'First Message' },
  { key: 'mesExample', label: 'Example Messages' },
  { key: 'systemPrompt', label: 'System Prompt' },
  { key: 'postHistoryInstructions', label: 'Post-History Instructions' },
];

export function CharacterDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const characterId = Number(id);
  const [showRaw, setShowRaw] = useState(false);
  const [showPersonaLink, setShowPersonaLink] = useState(false);
  const [tab, setTab] = useState<'card' | 'chats'>('card');

  const detail = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.character(characterId),
    enabled: Number.isInteger(characterId),
  });
  // Shared with ChatsSection (same key → one fetch); used for the tab count.
  const chats = useQuery({
    queryKey: ['character-chats', characterId],
    queryFn: () => api.characterChats(characterId),
    enabled: Number.isInteger(characterId),
  });
  const chatCount = chats.data?.length ?? 0;
  const renderHtml = useRenderHtml();
  const raw = useQuery({
    queryKey: ['character-raw', characterId],
    queryFn: () => api.characterRaw(characterId),
    enabled: showRaw, // fetched only when the modal is first opened
    staleTime: Infinity,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCharacter(characterId),
    onSuccess: () => navigate('/'),
  });

  if (detail.isLoading) return <LoadingState />;
  if (detail.isError || !detail.data) {
    return <EmptyState title="Character not found" hint={String(detail.error ?? '')} />;
  }
  const ch = detail.data;

  return (
    <div className="space-y-4">
      <div className='mb-2'>
        <Link to="/" className="text-sm text-ink-muted hover:text-accent-deep">
          ← Back to library
        </Link>
      </div>
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {ch.hasAvatar ? (
              <img src={avatarUrl(ch.id, ch.updatedAt)} alt={ch.name} className="w-full" />
            ) : (
              <Monogram name={ch.name} className="aspect-[2/3] w-full" />
            )}
          </div>
          <div className="space-y-2 rounded-card border border-line bg-surface p-4 text-sm">
            <h1 className="font-display text-xl leading-snug">{ch.name}</h1>
            {ch.creator && <p className="text-ink-muted">by {ch.creator}</p>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge tone="accent">{ch.spec === 'chara_card_v3' ? 'V3' : 'V2'}</Badge>
              {ch.characterVersion && <Badge>v{ch.characterVersion}</Badge>}
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {ch.tags.map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </div>
            <dl className="space-y-1 pt-2 text-xs text-ink-muted">
              <div>imported {ch.createdAt}</div>
              <div>
                source: <span className="font-mono">{ch.originalFilename}</span>
              </div>
            </dl>
            <div className="flex gap-2 pt-2">
              <a
                href={characterExportUrl(ch.id)}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-center text-white hover:bg-accent-deep"
              >
                Export
              </a>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRaw(true)}
                className="flex-1 rounded-lg border border-line px-3 py-1.5 hover:border-accent/50"
              >
                Raw JSON
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove "${ch.name}" from the library? The original file in the watch folder is not touched.`)) {
                    remove.mutate();
                  }
                }}
                className="rounded-lg border border-danger/40 px-3 py-1.5 text-danger hover:bg-danger/10"
              >
                Delete
              </button>
            </div>
          </div>
          {ch.lorebooks.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="mb-2 font-display">Lorebooks</h2>
              <ul className="space-y-2 text-sm">
                {ch.lorebooks.map((lb) => (
                  <li key={lb.id}>
                    <Link
                      to={`/lorebooks/${lb.id}`}
                      className="flex items-center justify-between rounded-lg border border-line px-3 py-2 hover:border-accent/50"
                    >
                      <span>{lb.name}</span>
                      <span className="text-xs text-ink-muted">{lb.entryCount} entries</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-card border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display">Personas</h2>
              <button
                type="button"
                onClick={() => setShowPersonaLink(true)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent/50"
              >
                Link persona
              </button>
            </div>
            {ch.personas.length === 0 ? (
              <p className="text-xs text-ink-muted">No personas connected.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {ch.personas.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/personas/${p.id}`}
                      className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 hover:border-accent/50"
                    >
                      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2">
                        {p.hasAvatar ? (
                          <img
                            src={personaAvatarUrl(p.id, '')}
                            alt={p.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Monogram name={p.name} className="h-full w-full [&>span]:text-sm" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.group && <GroupChip dot name={p.group.name} color={p.group.color} />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          <Segmented
            options={[
              { value: 'card', label: 'Card' },
              { value: 'chats', label: chatCount > 0 ? `Chats (${chatCount})` : 'Chats' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'card' ? (
            <>
              {FIELD_SECTIONS.map(({ key, label }) => (
                <FieldSection
                  key={key}
                  label={label}
                  value={String(ch[key] ?? '')}
                  renderHtml={renderHtml}
                />
              ))}
              <GreetingsSection greetings={ch.alternateGreetings} renderHtml={renderHtml} />
              <details className="rounded-card border border-line bg-surface">
                <summary className="cursor-pointer px-4 py-3 font-display">
                  Extensions{' '}
                  {Object.keys(ch.extensions).length === 0 && (
                    <span className="text-xs font-sans text-ink-muted">(empty)</span>
                  )}
                </summary>
                <pre className="overflow-x-auto border-t border-line bg-surface-2 p-4 font-mono text-xs">
                  {JSON.stringify(ch.extensions, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <ChatsSection characterId={ch.id} />
          )}
        </section>

        {showPersonaLink && (
          <PersonaLinkModal
            characterId={ch.id}
            characterName={ch.name}
            linkedIds={ch.personas.map((p) => p.id)}
            onClose={() => setShowPersonaLink(false)}
          />
        )}
        {showRaw && (
          <JsonModal
            title={`${ch.name} — raw card JSON`}
            data={raw.data}
            loading={raw.isLoading}
            error={raw.isError ? String(raw.error) : null}
            onClose={() => setShowRaw(false)}
          />
        )}
      </div>
    </div>
  );
}

function FieldSection({
  label,
  value,
  renderHtml,
}: {
  label: string;
  value: string;
  renderHtml: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const empty = !value.trim();
  // Every field is shown and foldable; empty ones start folded.
  return (
    <details open={!empty} className="group rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
        <span className="font-display">
          {label} {empty && <span className="font-sans text-xs text-ink-muted">(empty)</span>}
        </span>
        {!empty && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent/50"
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        )}
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm leading-relaxed">
        {empty ? (
          <span className="text-xs text-ink-muted">This field is empty.</span>
        ) : (
          <RichText text={value} allowHtml={renderHtml} markdown={false} />
        )}
      </div>
    </details>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatsSection({ characterId }: { characterId: number }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const chats = useQuery({
    queryKey: ['character-chats', characterId],
    queryFn: () => api.characterChats(characterId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['character-chats', characterId] });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadChat(characterId, file),
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: (e) => setError(String(e instanceof Error ? e.message : e)),
  });
  const rename = useMutation({
    mutationFn: ({ chatId, name }: { chatId: number; name: string }) =>
      api.renameChat(chatId, name),
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: (e) => setError(String(e instanceof Error ? e.message : e)),
  });
  const remove = useMutation({
    mutationFn: (chatId: number) => api.deleteChat(chatId),
    onSuccess: () => void invalidate(),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-uploading the same filename
    if (file) upload.mutate(file);
  };

  const onRename = (chatId: number, current: string) => {
    const name = prompt('Rename chat', current)?.trim();
    if (name && name !== current) rename.mutate({ chatId, name });
  };

  const items = chats.data ?? [];

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display">Chats</h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent/50 disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : 'Upload .jsonl'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".jsonl,application/jsonl,application/x-ndjson"
          className="hidden"
          onChange={onPick}
        />
      </div>
      <div className="px-4 py-3 text-sm">
        {error && (
          <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No chats yet. Upload a SillyTavern .jsonl backup to view it here.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((chat) => (
              <li
                key={chat.id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <Link
                  to={`/characters/${characterId}/chats/${chat.id}`}
                  className="min-w-0 flex-1 hover:text-accent-deep"
                >
                  <div className="truncate font-medium" title={chat.originalFilename}>
                    {chat.originalFilename}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {chat.messageCount} messages · {formatBytes(chat.fileSize)}
                    {chat.createDate && <> · {chat.createDate}</>}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => onRename(chat.id, chat.originalFilename)}
                  className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent/50"
                >
                  Rename
                </button>
                <a
                  href={chatDownloadUrl(chat.id)}
                  className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent/50"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete chat "${chat.originalFilename}"?`)) remove.mutate(chat.id);
                  }}
                  className="rounded-md border border-danger/40 px-2 py-0.5 text-xs text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GreetingsSection({
  greetings,
  renderHtml,
}: {
  greetings: string[];
  renderHtml: boolean;
}) {
  const [index, setIndex] = useState(0);
  const empty = greetings.length === 0;
  const current = greetings[index] ?? '';
  return (
    <details open={!empty} className="rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
        <span className="font-display">
          Alternate Greetings{' '}
          {empty && <span className="font-sans text-xs text-ink-muted">(empty)</span>}
        </span>
        {!empty && (
          <span className="flex items-center gap-2 text-xs">
            <button
              type="button"
              disabled={index <= 0}
              onClick={(e) => {
                e.preventDefault();
                setIndex(index - 1);
              }}
              className="rounded-md border border-line px-2 py-0.5 disabled:opacity-40"
            >
              ←
            </button>
            <span className="text-ink-muted">
              {index + 1} / {greetings.length}
            </span>
            <button
              type="button"
              disabled={index >= greetings.length - 1}
              onClick={(e) => {
                e.preventDefault();
                setIndex(index + 1);
              }}
              className="rounded-md border border-line px-2 py-0.5 disabled:opacity-40"
            >
              →
            </button>
          </span>
        )}
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm leading-relaxed">
        {empty ? (
          <span className="text-xs text-ink-muted">No alternate greetings.</span>
        ) : (
          <RichText text={current} allowHtml={renderHtml} markdown={false} />
        )}
      </div>
    </details>
  );
}

