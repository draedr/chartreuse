import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { SearchHit } from '@chartreuse/shared';
import { api } from '../api/client';
import { Badge, EmptyState, SearchBar, Snippet } from '../components/ui';

const CHARACTER_FIELDS = [
  'name', 'creator', 'tags', 'description', 'personality', 'scenario',
  'first_mes', 'mes_example', 'alternate_greetings', 'creator_notes',
  'system_prompt', 'post_history_instructions',
];
const LOREBOOK_FIELDS = ['name', 'description', 'entry_keys', 'entry_content', 'entry_comments'];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const fields = (params.get('fields') ?? '').split(',').filter(Boolean);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const toggleField = (f: string) => {
    const next = fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f];
    update({ fields: next.join(',') || null });
  };

  const results = useQuery({
    queryKey: ['search', q, fields.join(',')],
    queryFn: () => api.search(q, fields),
    enabled: q.trim().length > 0,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-3 font-display text-2xl">Search everything</h1>
        <SearchBar
          value={q}
          onChange={(v) => update({ q: v || null })}
          placeholder='Search characters and lorebooks… use "quotes" for phrases'
          autoFocus
        />
      </div>

      <div className="grid gap-3 rounded-card border border-line bg-surface p-4 text-xs sm:grid-cols-2">
        <FieldGroup
          title="Character fields"
          allFields={CHARACTER_FIELDS}
          selected={fields}
          onToggle={toggleField}
        />
        <FieldGroup
          title="Lorebook fields"
          allFields={LOREBOOK_FIELDS}
          selected={fields}
          onToggle={toggleField}
        />
        {fields.length > 0 && (
          <button
            type="button"
            onClick={() => update({ fields: null })}
            className="justify-self-start text-accent-deep underline-offset-2 hover:underline"
          >
            clear field scoping (search all fields)
          </button>
        )}
      </div>

      {!q.trim() && (
        <EmptyState title="Type to search" hint="Fulltext across every character and lorebook field, ranked by relevance." />
      )}
      {results.isLoading && <p className="text-ink-muted">Searching…</p>}

      {results.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ResultSection
            title="Characters"
            hits={results.data.characters}
            linkBase="/characters"
          />
          <ResultSection title="Lorebooks" hits={results.data.lorebooks} linkBase="/lorebooks" />
        </div>
      )}
    </div>
  );
}

function FieldGroup({
  title,
  allFields,
  selected,
  onToggle,
}: {
  title: string;
  allFields: string[];
  selected: string[];
  onToggle: (f: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 font-display text-sm">{title}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {allFields.map((f) => (
          <label key={f} className="flex cursor-pointer items-center gap-1 text-ink-muted">
            <input
              type="checkbox"
              checked={selected.includes(f)}
              onChange={() => onToggle(f)}
              className="accent-(--color-accent)"
            />
            {f.replaceAll('_', ' ')}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ResultSection({
  title,
  hits,
  linkBase,
}: {
  title: string;
  hits: SearchHit[];
  linkBase: string;
}) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg">
        {title} <span className="text-sm text-ink-muted">({hits.length})</span>
      </h2>
      {hits.length === 0 ? (
        <p className="text-sm text-ink-muted">No matches.</p>
      ) : (
        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Link
                to={`${linkBase}/${hit.id}`}
                className="block rounded-card border border-line bg-surface px-4 py-3 hover:shadow-md hover:shadow-ink/5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-display">{hit.name}</span>
                  {hit.matchedField && (
                    <Badge>matched in: {hit.matchedField.replaceAll('_', ' ')}</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm">
                  <Snippet text={hit.snippet} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
