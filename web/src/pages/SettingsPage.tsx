import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTheme } from '../components/ui';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [dark, toggleTheme] = useTheme();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const [cardsDir, setCardsDir] = useState('');
  const [lorebooksDir, setLorebooksDir] = useState('');
  const [interval, setIntervalSec] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setCardsDir(settings.data.watchCardsDir);
      setLorebooksDir(settings.data.watchLorebooksDir);
      setIntervalSec(String(settings.data.rescanIntervalSec));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.putSettings({
        watchCardsDir: cardsDir,
        watchLorebooksDir: lorebooksDir,
        rescanIntervalSec: Number(interval),
      }),
    onSuccess: () => {
      setMessage('Saved — watchers restarted.');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setMessage(`Failed: ${String(err)}`),
  });
  const reindex = useMutation({
    mutationFn: api.reindex,
    onSuccess: () => setMessage('Search index rebuilt.'),
  });

  const counts = settings.data?.counts;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl">Settings</h1>

      {counts && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="characters" value={counts.characters} />
          <Stat label="lorebooks" value={counts.lorebooks} />
          <Stat label="quarantined" value={counts.quarantined} />
        </div>
      )}

      <section className="space-y-4 rounded-card border border-line bg-surface p-5">
        <h2 className="font-display text-lg">Watch folders</h2>
        <p className="text-xs text-ink-muted">
          Files dropped into these folders are imported automatically. When running in Docker these
          are <em>container</em> paths — change the host side via the bind mounts in
          docker-compose.yml.
        </p>
        <Field label="Character cards folder (.png / .json)">
          <input
            value={cardsDir}
            onChange={(e) => setCardsDir(e.target.value)}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Lorebooks folder (.json)">
          <input
            value={lorebooksDir}
            onChange={(e) => setLorebooksDir(e.target.value)}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Full rescan interval (seconds)">
          <input
            type="number"
            min={10}
            value={interval}
            onChange={(e) => setIntervalSec(e.target.value)}
            className="w-40 rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save & restart watchers'}
          </button>
          {message && <span className="text-xs text-ink-muted">{message}</span>}
        </div>
      </section>

      <section className="flex items-center justify-between rounded-card border border-line bg-surface p-5">
        <div>
          <h2 className="font-display text-lg">Appearance</h2>
          <p className="text-xs text-ink-muted">Warm ivory or warm charcoal.</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent/50"
        >
          {dark ? '☀️ Switch to light' : '🌙 Switch to dark'}
        </button>
      </section>

      <section className="flex items-center justify-between rounded-card border border-line bg-surface p-5">
        <div>
          <h2 className="font-display text-lg">Search index</h2>
          <p className="text-xs text-ink-muted">
            Rebuild the fulltext index if search results ever look stale.
          </p>
        </div>
        <button
          type="button"
          onClick={() => reindex.mutate()}
          disabled={reindex.isPending}
          className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent/50 disabled:opacity-50"
        >
          {reindex.isPending ? 'Rebuilding…' : 'Rebuild index'}
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 text-center">
      <div className="font-display text-2xl text-accent-deep">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
