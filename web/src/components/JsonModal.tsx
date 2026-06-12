import { useEffect, useState, type ReactNode } from 'react';

/**
 * Tokenizes pretty-printed JSON into colored React spans (no innerHTML —
 * card text is arbitrary user content). Token kinds: object keys, strings,
 * numbers, booleans/null; everything else (punctuation/whitespace) is muted.
 */
function highlightJson(pretty: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(pretty)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={i++} className="text-ink-muted">
          {pretty.slice(last, m.index)}
        </span>,
      );
    }
    const [whole, str, colon] = m;
    if (str !== undefined) {
      if (colon !== undefined) {
        nodes.push(
          <span key={i++} className="text-accent-deep">
            {str}
          </span>,
          <span key={i++} className="text-ink-muted">
            {colon}
          </span>,
        );
      } else {
        nodes.push(
          <span key={i++} className="text-emerald-700 dark:text-emerald-400">
            {str}
          </span>,
        );
      }
    } else if (whole === 'true' || whole === 'false' || whole === 'null') {
      nodes.push(
        <span key={i++} className="text-purple-700 dark:text-purple-400">
          {whole}
        </span>,
      );
    } else {
      nodes.push(
        <span key={i++} className="text-sky-700 dark:text-sky-400">
          {whole}
        </span>,
      );
    }
    last = m.index + whole.length;
  }
  if (last < pretty.length) {
    nodes.push(
      <span key={i++} className="text-ink-muted">
        {pretty.slice(last)}
      </span>,
    );
  }
  return nodes;
}

/** Near-fullscreen modal rendering formatted + highlighted JSON. */
export function JsonModal({
  title,
  data,
  loading = false,
  error,
  onClose,
}: {
  title: string;
  data: unknown;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = data !== undefined ? JSON.stringify(data, null, 2) : '';

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

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="absolute inset-3 flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-2xl shadow-ink/30 md:inset-8">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-lg">{title}</h2>
          {pretty && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(pretty).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent/50"
            >
              {copied ? 'copied ✓' : 'copy'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:border-accent/50 hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto bg-surface-2 p-4">
          {loading && <p className="text-sm text-ink-muted">Loading…</p>}
          {error && <p className="text-sm text-danger">Could not load: {error}</p>}
          {pretty && (
            <pre className="font-mono whitespace-pre-wrap text-xs leading-relaxed">{highlightJson(pretty)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
