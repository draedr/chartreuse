import { useEffect, useRef, useState } from 'react';
import type { TagCount } from '@chartreuse/shared';

/** Autocomplete input: type to filter known tags, pick via click/Enter. */
export function TagSuggest({
  options,
  taken,
  onAdd,
  placeholder,
}: {
  options: TagCount[];
  /** Tags already used (in either list) — hidden from suggestions. */
  taken: string[];
  onAdd: (tag: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const needle = text.trim().toLowerCase();
  const matches = options
    .filter((t) => !taken.includes(t.name))
    .filter((t) => !needle || t.name.toLowerCase().includes(needle))
    .slice(0, 8);

  const pick = (tag: string) => {
    onAdd(tag);
    setText('');
    setOpen(false);
  };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) pick(matches[0].name);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-ink-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg shadow-ink/10">
          {matches.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t.name);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span>{t.name}</span>
                <span className="text-xs text-ink-muted">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tag pill with a remove button. `excluded` renders the dashed "not:" variant. */
export function RemovablePill({
  tag,
  excluded = false,
  onRemove,
}: {
  tag: string;
  excluded?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs ${
        excluded
          ? 'border border-dashed border-danger/50 text-danger'
          : 'border border-transparent bg-accent-soft/60 text-ink'
      }`}
    >
      {excluded && <span className="opacity-70">not:</span>}
      {tag}
      <button
        type="button"
        onClick={onRemove}
        title={`Remove ${tag}`}
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none ${
          excluded ? 'hover:bg-danger/15' : 'hover:bg-accent/20'
        }`}
      >
        ×
      </button>
    </span>
  );
}

/** Segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1.5 transition-colors ${
            value === opt.value
              ? 'bg-accent-soft text-accent-deep'
              : 'bg-surface text-ink-muted hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Dropdown with checkboxes selecting which columns fulltext search applies to. */
export function FieldsDropdown({
  allFields,
  selected,
  onChange,
}: {
  allFields: readonly string[];
  selected: string[];
  onChange: (fields: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = (f: string) => {
    onChange(selected.includes(f) ? selected.filter((x) => x !== f) : [...selected, f]);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs hover:border-accent/50"
      >
        {selected.length === 0 ? 'search in: all fields' : `search in: ${selected.length} field(s)`}{' '}
        ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-60 rounded-xl border border-line bg-surface p-2 shadow-lg shadow-ink/10">
          <div className="grid gap-1">
            {allFields.map((f) => (
              <label
                key={f}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-ink hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(f)}
                  onChange={() => toggle(f)}
                  className="accent-(--color-accent)"
                />
                {f.replaceAll('_', ' ')}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-accent-deep hover:bg-surface-2"
            >
              reset (search all fields)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Number input that commits on blur/Enter (avoids a refetch per keystroke). */
export function CommitNumberInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => {
    const clean = local.trim() === '' ? '' : String(Math.max(0, Number(local) || 0));
    setLocal(clean);
    if (clean !== value) onCommit(clean);
  };
  return (
    <input
      type="number"
      min={0}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className="w-28 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none"
    />
  );
}
