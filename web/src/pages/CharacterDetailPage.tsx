import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CharacterDetail } from '@chartreuse/shared';
import { api, avatarUrl, characterExportUrl } from '../api/client';
import { Badge, EmptyState, Monogram, TagChip } from '../components/ui';

const FIELD_SECTIONS: { key: keyof CharacterDetail; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'personality', label: 'Personality' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'firstMes', label: 'First Message' },
  { key: 'mesExample', label: 'Example Messages' },
  { key: 'creatorNotes', label: 'Creator Notes' },
  { key: 'systemPrompt', label: 'System Prompt' },
  { key: 'postHistoryInstructions', label: 'Post-History Instructions' },
];

export function CharacterDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const characterId = Number(id);

  const detail = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.character(characterId),
    enabled: Number.isInteger(characterId),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCharacter(characterId),
    onSuccess: () => navigate('/'),
  });

  if (detail.isLoading) return <p className="text-ink-muted">Loading…</p>;
  if (detail.isError || !detail.data) {
    return <EmptyState title="Character not found" hint={String(detail.error ?? '')} />;
  }
  const ch = detail.data;

  return (
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
                    <span>📖 {lb.name}</span>
                    <span className="text-xs text-ink-muted">{lb.entryCount} entries</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section className="min-w-0 space-y-3">
        {FIELD_SECTIONS.map(({ key, label }) => (
          <FieldSection key={key} label={label} value={String(ch[key] ?? '')} />
        ))}
        {ch.alternateGreetings.length > 0 && (
          <GreetingsSection greetings={ch.alternateGreetings} />
        )}
        {Object.keys(ch.extensions).length > 0 && (
          <details className="rounded-card border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 font-display">Extensions (raw)</summary>
            <pre className="overflow-x-auto border-t border-line bg-surface-2 p-4 font-mono text-xs">
              {JSON.stringify(ch.extensions, null, 2)}
            </pre>
          </details>
        )}
      </section>
    </div>
  );
}

function FieldSection({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value.trim()) return null;
  return (
    <details open className="group rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
        <span className="font-display">{label}</span>
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
      </summary>
      <div className="whitespace-pre-wrap border-t border-line px-4 py-3 text-sm leading-relaxed">
        {value}
      </div>
    </details>
  );
}

function GreetingsSection({ greetings }: { greetings: string[] }) {
  const [index, setIndex] = useState(0);
  const current = greetings[index] ?? '';
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-display">Alternate Greetings</span>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => setIndex(index - 1)}
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
            onClick={() => setIndex(index + 1)}
            className="rounded-md border border-line px-2 py-0.5 disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>
      <div className="whitespace-pre-wrap border-t border-line px-4 py-3 text-sm leading-relaxed">
        {current}
      </div>
    </div>
  );
}
