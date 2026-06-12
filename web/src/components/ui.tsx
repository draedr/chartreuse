import { useEffect, useState, type ReactNode } from 'react';

/** Renders server snippets: control-char marker spans (0x01/0x02) become highlighted marks. */
export function Snippet({ text, className = '' }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  const re = new RegExp(String.fromCharCode(1) + '([^]*?)' + String.fromCharCode(2), 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <mark key={i++} className="snippet-mark">
        {m[1]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <span className={`text-ink-muted ${className}`}>{nodes}</span>;
}

export function TagChip({
  tag,
  active = false,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const base = 'inline-block rounded-full px-2.5 py-0.5 text-xs border transition-colors';
  const palette = active
    ? 'bg-accent text-white border-accent'
    : 'bg-accent-soft/60 text-ink border-transparent hover:border-accent/50';
  if (!onClick) return <span className={`${base} ${palette}`}>{tag}</span>;
  return (
    <button type="button" onClick={onClick} className={`${base} ${palette} cursor-pointer`}>
      {tag}
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
        tone === 'accent'
          ? 'border-accent/40 text-accent-deep bg-accent-soft/50'
          : 'border-line text-ink-muted bg-surface-2'
      }`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-10 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="mt-2 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

export function Pagination({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-center gap-3 text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 disabled:opacity-40 hover:border-accent/50"
      >
        ← Prev
      </button>
      <span className="text-ink-muted">
        Page {page} of {pages} · {total} total
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 disabled:opacity-40 hover:border-accent/50"
      >
        Next →
      </button>
    </nav>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  // Debounce keystrokes before pushing upstream (URL params / queries).
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);

  return (
    <input
      type="search"
      value={local}
      autoFocus={autoFocus}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm placeholder:text-ink-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
    />
  );
}

export function Monogram({ name, className = '' }: { name: string; className?: string }) {
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      className={`flex items-center justify-center bg-accent-soft text-accent-deep ${className}`}
    >
      <span className="font-display text-5xl">{letter}</span>
    </div>
  );
}

/** Readable text color (near-black or white) for an arbitrary #rrggbb background. */
export function contrastText(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return luminance > 0.45 ? '#1a1a18' : '#ffffff';
}

/** Colored persona-group chip (runtime colors can't come from Tailwind classes). */
export function GroupChip({
  name,
  color,
  dot = false,
  onClick,
  active = false,
}: {
  name: string;
  color: string;
  /** Render as a small color dot with a title instead of a full chip. */
  dot?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  if (dot) {
    return (
      <span
        title={name}
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }
  const style = { backgroundColor: color, color: contrastText(color) };
  const cls = `inline-block rounded-full px-2.5 py-0.5 text-xs ${
    active ? 'ring-2 ring-accent ring-offset-1 ring-offset-paper' : ''
  }`;
  if (!onClick) {
    return (
      <span className={cls} style={style}>
        {name}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer`} style={style}>
      {name}
    </button>
  );
}

export type ViewMode = 'grid' | 'list';

/** Grid/list preference, persisted per page. */
export function useViewMode(storageKey: string, fallback: ViewMode = 'grid'): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'grid' || stored === 'list' ? stored : fallback;
  });
  const set = (v: ViewMode) => {
    setMode(v);
    localStorage.setItem(storageKey, v);
  };
  return [mode, set];
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (v: ViewMode, label: string, title: string) => (
    <button
      type="button"
      title={title}
      onClick={() => onChange(v)}
      className={`px-2.5 py-2 text-sm transition-colors ${
        mode === v ? 'bg-accent-soft text-accent-deep' : 'bg-surface text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group">
      {btn('grid', '▦', 'Grid view')}
      {btn('list', '☰', 'List view')}
    </div>
  );
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('chartreuse-theme', next ? 'dark' : 'light');
  };
  return [dark, toggle];
}
