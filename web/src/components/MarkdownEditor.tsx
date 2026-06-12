import { useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Segmented } from './filters';

/**
 * Lossless markdown tokenizer → colored React spans (no innerHTML). Every
 * character of the input is emitted exactly once, in order, with color-only
 * styling so the overlay stays perfectly aligned with the textarea text.
 */
function highlightMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const push = (s: string, cls: string) => {
    if (s) nodes.push(<span key={key++} className={cls}>{s}</span>);
  };

  const INLINE =
    /(`+)([^`]*?)\1|(\*\*|__)([^*_]+?)\3|([*_])([^*_]+?)\5|(\[)([^\]]*)(\]\()([^)]*)(\))/g;
  const pushInline = (line: string) => {
    let last = 0;
    let m: RegExpExecArray | null;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(line)) !== null) {
      push(line.slice(last, m.index), '');
      if (m[1] !== undefined) {
        // `code`
        push(m[0], 'text-purple-700 dark:text-purple-400');
      } else if (m[3] !== undefined) {
        // **bold**
        push(m[3], 'text-ink-muted');
        push(m[4]!, 'font-bold');
        push(m[3], 'text-ink-muted');
      } else if (m[5] !== undefined) {
        // *italic*
        push(m[5], 'text-ink-muted');
        push(m[6]!, 'italic');
        push(m[5], 'text-ink-muted');
      } else {
        // [text](url)
        push(m[7]!, 'text-ink-muted');
        push(m[8]!, 'text-sky-700 dark:text-sky-400');
        push(m[9]!, 'text-ink-muted');
        push(m[10]!, 'text-emerald-700 dark:text-emerald-400 underline');
        push(m[11]!, 'text-ink-muted');
      }
      last = m.index + m[0].length;
    }
    push(line.slice(last), '');
  };

  const lines = text.split('\n');
  let inFence = false;
  lines.forEach((line, idx) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      push(line, 'text-purple-700 dark:text-purple-400');
      inFence = !inFence;
    } else if (inFence) {
      push(line, 'text-purple-700/80 dark:text-purple-400/80');
    } else {
      const heading = line.match(/^(#{1,6})(\s+)(.*)$/);
      const quote = line.match(/^(\s*>+\s?)(.*)$/);
      const list = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
      if (heading) {
        push(heading[1]!, 'text-ink-muted');
        push(heading[2]!, '');
        push(heading[3]!, 'font-bold text-accent-deep');
      } else if (quote) {
        push(quote[1]!, 'text-emerald-700 dark:text-emerald-400');
        pushInline(quote[2]!);
      } else if (list) {
        push(list[1]!, 'text-accent-deep');
        pushInline(list[2]!);
      } else {
        pushInline(line);
      }
    }
    if (idx < lines.length - 1) push('\n', '');
  });
  return nodes;
}

/** Layout-affecting classes shared by both overlay layers — must be identical. */
const METRICS =
  'whitespace-pre-wrap break-words p-3 font-mono text-sm leading-relaxed';

export function MarkdownEditor({
  value,
  onChange,
  defaultTab = 'write',
}: {
  value: string;
  onChange: (v: string) => void;
  defaultTab?: 'write' | 'preview';
}) {
  const [tab, setTab] = useState<'write' | 'preview'>(defaultTab);
  const preRef = useRef<HTMLPreElement>(null);

  return (
    <div className="space-y-2">
      <Segmented
        options={[
          { value: 'write', label: 'Write' },
          { value: 'preview', label: 'Preview' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'write' ? (
        <div className="relative h-[28rem] overflow-hidden rounded-xl border border-line bg-surface focus-within:border-accent">
          <pre
            ref={preRef}
            aria-hidden
            className={`pointer-events-none absolute inset-0 m-0 overflow-y-auto ${METRICS}`}
          >
            {highlightMarkdown(value)}
            {'\n' /* keeps both layers the same height for a trailing newline */}
          </pre>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => {
              if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            placeholder={value ? undefined : 'Describe the persona in markdown…'}
            className={`absolute inset-0 resize-none overflow-y-auto bg-transparent text-transparent caret-(--color-ink) placeholder:text-ink-muted/50 focus:outline-none ${METRICS}`}
          />
        </div>
      ) : (
        <div className="markdown-preview h-[28rem] overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm">
          {value.trim() ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <p className="text-ink-muted">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
