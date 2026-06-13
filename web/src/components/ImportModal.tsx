import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ImportUploadResult } from '@chartreuse/shared';
import { api } from '../api/client';

const OUTCOME_LABEL: Record<ImportUploadResult['outcome'], string> = {
  imported: 'Imported',
  duplicate: 'Skipped (already in library)',
  quarantined: 'Quarantined',
  error: 'Failed',
};

const OUTCOME_CLASS: Record<ImportUploadResult['outcome'], string> = {
  imported: 'text-emerald-700 dark:text-emerald-400',
  duplicate: 'text-ink-muted',
  quarantined: 'text-amber-600 dark:text-amber-400',
  error: 'text-danger',
};

/** Upload character cards (.png/.json) into the watched folder from the UI. */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ImportUploadResult[] | null>(null);
  const [dragging, setDragging] = useState(false);

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

  const isCard = (f: File) => /\.(png|json)$/i.test(f.name);

  const addFiles = (incoming: FileList | File[]) => {
    const cards = [...incoming].filter(isCard);
    setResults(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...cards.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const importMutation = useMutation({
    mutationFn: () => api.importCards(files),
    onSuccess: (data) => {
      setResults(data.results);
      setFiles([]);
      // Anything actually added to the library should refresh the listings.
      if (data.results.some((r) => r.outcome === 'imported')) {
        void queryClient.invalidateQueries({ queryKey: ['characters'] });
        void queryClient.invalidateQueries({ queryKey: ['tags'] });
      }
    },
  });

  const summary = results && {
    imported: results.filter((r) => r.outcome === 'imported').length,
    duplicate: results.filter((r) => r.outcome === 'duplicate').length,
    failed: results.filter((r) => r.outcome === 'error' || r.outcome === 'quarantined').length,
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Import cards">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="absolute inset-x-3 top-10 mx-auto flex max-h-[80vh] max-w-lg flex-col overflow-hidden rounded-card border border-line bg-surface shadow-2xl shadow-ink/30">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-lg">Import character cards</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:border-accent/50 hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-sm transition-colors ${
              dragging ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-accent/50'
            }`}
          >
            <span className="font-medium">Drop cards here or click to browse</span>
            <span className="text-xs text-ink-muted">
              .png or .json — saved to the watch folder
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".png,.json,image/png,application/json"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {files.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                <span>
                  {files.length} file{files.length === 1 ? '' : 's'} ready
                </span>
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="hover:text-ink"
                >
                  clear
                </button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-auto">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}:${f.size}`}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={f.name}>
                      {f.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-ink-muted hover:text-danger"
                      title="Remove"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {importMutation.isError && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {String(importMutation.error instanceof Error ? importMutation.error.message : importMutation.error)}
            </p>
          )}

          {results && (
            <div className="space-y-2">
              {summary && (
                <p className="text-xs text-ink-muted">
                  {summary.imported} imported · {summary.duplicate} skipped
                  {summary.failed > 0 && ` · ${summary.failed} failed`}
                </p>
              )}
              <ul className="max-h-48 space-y-1 overflow-auto">
                {results.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={r.filename}>
                      {r.characterId && r.outcome === 'imported' ? (
                        <Link
                          to={`/characters/${r.characterId}`}
                          onClick={onClose}
                          className="hover:text-accent-deep"
                        >
                          {r.filename}
                        </Link>
                      ) : (
                        r.filename
                      )}
                    </span>
                    <span className={`shrink-0 text-xs ${OUTCOME_CLASS[r.outcome]}`} title={r.error}>
                      {OUTCOME_LABEL[r.outcome]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent/50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={files.length === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importing…' : `Import${files.length ? ` (${files.length})` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
