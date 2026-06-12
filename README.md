# Chartreuse

A single-user, self-hosted library for **SillyTavern character cards and lorebooks** with a
Claude-inspired interface. Drop `.png` / `.json` cards and world-info files into watch folders
and they are imported, indexed, and searchable automatically.

## Features

- **Fulltext search** (SQLite FTS5, bm25-ranked, prefix matching, phrase queries, per-field
  scoping) across every character field — name, description, personality, scenario, first
  message, example messages, creator notes, system prompt, post-history instructions,
  alternate greetings, tags, creator — and every lorebook field (name, description, entry
  keys, content, comments), with match highlighting.
- **Lorebooks are first-class**: standalone SillyTavern world-info files live in their own
  store; lorebooks embedded in cards (`character_book`) are extracted, linked to their
  character, and browsable/exportable on their own (exported as standalone world-info JSON).
- **Watch-folder auto-import**: one folder for cards (`.png` with embedded metadata, or
  `.json`), a separate folder for lorebooks (`.json`). Polling-based (works through Docker
  bind mounts) plus a periodic full rescan. Newly found files are imported as a **batch**:
  the Imports page reports how many were found and a live progress counter, and that
  folder's watcher is **paused until the batch finishes** (cards and lorebooks are tracked
  independently). Deduplicated by content hash — the same card as PNG and JSON imports
  once. Malformed files are quarantined with the error, never crash the importer, and can
  be retried from the UI.
- **Read-only manager**: browse, filter (tags AND-combined, creator, has-lorebook, origin,
  exact entry key), view every field, and export the **byte-identical original file**.
  Editing is out of scope by design.
- Supports **Character Card V2 and V3** (PNG `chara` / `ccv3` chunks, `ccv3` preferred),
  bare v1-style JSON, and both world-info entry formats (keyed object and array).

## Quick start (Docker)

```bash
docker compose up --build
```

Then open <http://localhost:3000> and drop files into `./watch/cards` and
`./watch/lorebooks`. Library data (SQLite db, original files, avatars, quarantine) persists
in the `chartreuse-data` volume.

Note: the watch-folder paths shown in **Settings** are *container* paths
(`/watch/cards`, `/watch/lorebooks`); change the host side by editing the bind mounts in
`docker-compose.yml`.

## Development

```bash
npm install
npm run build -w @chartreuse/shared   # once (server/web import its built types)
npm run dev:server                    # API + watcher on :3000
npm run dev:web                       # Vite dev server on :5173 (proxies /api)
```

Configuration via env vars (see `.env.example`): `PORT`, `DATA_DIR`, `WATCH_CARDS_DIR`,
`WATCH_LOREBOOKS_DIR`, `RESCAN_INTERVAL_SEC`. Watch folders and the rescan interval can also
be changed at runtime in Settings (stored in the db; db values take precedence after first
boot).

Manual import without the watcher:

```bash
npm run import -- path/to/card.png
npm run import -- path/to/worldinfo.json lorebook
```

Tests (vitest — parsers, normalizers, import pipeline, FTS query builder, API round-trip):

```bash
npm test
```

Regenerate test fixtures: `npx tsx server/scripts/make-fixtures.ts`.

## Architecture

One Node 22 process: Hono HTTP API + static SPA + chokidar watcher + better-sqlite3 (WAL).
All imports run on a serial in-process queue so reads stay responsive during bulk drops.
React + Vite + Tailwind v4 frontend in `web/`, shared API types in `shared/`.

| Endpoint | Purpose |
|---|---|
| `GET /api/characters` | list/search/filter (`q, fields, tags, creator, has_lorebook, spec, sort, order, page, limit`) |
| `GET /api/characters/:id` · `/avatar` · `/export` · `DELETE` | detail, avatar PNG, original download, remove |
| `GET /api/lorebooks` | list/search (`q, fields, origin, character_id, key, sort, …`) |
| `GET /api/lorebooks/:id` · `/export` · `DELETE` | detail with entries, world-info download, remove (standalone only) |
| `GET /api/tags` | tag counts for the filter UI |
| `GET /api/imports` · `/quarantine` · `POST /rescan` · `POST /quarantine/:id/retry` | import activity + recovery |
| `GET/PUT /api/settings` | watch folders, rescan interval (live watcher restart) |
| `POST /api/admin/reindex` | rebuild the FTS index |
