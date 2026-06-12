# Chartreuse

Chartreuse is a single-user, self-hosted library for SillyTavern character cards
and lorebooks. Drop character cards or world-info files into watch folders and
Chartreuse imports them, stores the original files, indexes their contents, and
makes them searchable from a local web UI.

## What It Does

- Imports SillyTavern character cards from PNG metadata chunks or JSON files.
- Imports standalone lorebooks/world-info JSON files.
- Extracts embedded `character_book` lorebooks from character cards.
- Preserves byte-identical original files for export.
- Indexes character and lorebook fields with SQLite FTS5.
- Supports tag, creator, origin, lorebook, and entry-key filtering.
- Quarantines malformed files instead of crashing the importer.
- Provides a read-only browser for managing a local card and lorebook archive.

## Quick Start

The easiest way to run Chartreuse is with Docker Compose:

```bash
docker compose up --build
```

Open <http://localhost:3000>, then drop files into:

- `./watch/cards` for character cards (`.png` or `.json`)
- `./watch/lorebooks` for lorebooks/world-info files (`.json`)

Application data is stored in the `chartreuse-data` Docker volume. The default
container watch paths are `/watch/cards` and `/watch/lorebooks`; change the host
folders by editing the bind mounts in `docker-compose.yml`.

## Development

Chartreuse is an npm workspace with three packages:

- `shared`: shared TypeScript types
- `server`: Hono API, importer, watcher, SQLite storage
- `web`: React/Vite frontend

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

```bash
npm install
```

Build all packages:

```bash
npm run build
```

Run the API and watcher:

```bash
npm run dev:server
```

Run the Vite development server:

```bash
npm run dev:web
```

In development, the API serves on <http://localhost:3000> and the Vite app serves
on <http://localhost:5173>. The Vite app proxies API requests to the backend.

## Configuration

Configuration is read from environment variables on first boot. See
`.env.example` for defaults:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the backend |
| `DATA_DIR` | `./data` | SQLite database, originals, avatars, and quarantine storage |
| `WATCH_CARDS_DIR` | `./watch/cards` | Folder scanned for character cards |
| `WATCH_LOREBOOKS_DIR` | `./watch/lorebooks` | Folder scanned for lorebooks |
| `RESCAN_INTERVAL_SEC` | `300` | Interval for periodic full rescans |

Watch-folder paths and the rescan interval can also be changed from the Settings
page. Stored settings take precedence over environment values after the first
boot.

## Manual Import

You can import files without relying on the watcher:

```bash
npm run import -- path/to/card.png
npm run import -- path/to/card.json
npm run import -- path/to/worldinfo.json lorebook
```

## Tests

Run the server test suite:

```bash
npm test
```

The tests cover PNG metadata parsing, character/lorebook normalization, the
import pipeline, FTS query construction, and API round trips.

Regenerate test fixtures:

```bash
npx tsx server/scripts/make-fixtures.ts
```

## Supported Inputs

Character imports:

- Character Card V2 PNG cards with `chara` metadata
- Character Card V3 PNG cards with `ccv3` metadata
- JSON card files, including bare v1-style data

Lorebook imports:

- Standalone SillyTavern world-info JSON
- Keyed-object and array-style world-info entry formats
- Embedded character books from imported character cards

Duplicate files are detected by content hash. When a batch of files is found in a
watch folder, that watcher pauses until the batch finishes, while the other
watcher can continue independently.

## API Overview

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Health check |
| `GET /api/characters` | List, search, sort, and filter characters |
| `GET /api/characters/:id` | Character details |
| `GET /api/characters/:id/raw` | Original parsed character JSON |
| `GET /api/characters/:id/avatar` | Character avatar |
| `GET /api/characters/:id/export` | Original character file download |
| `DELETE /api/characters/:id` | Remove a character |
| `GET /api/lorebooks` | List, search, sort, and filter lorebooks |
| `GET /api/lorebooks/:id` | Lorebook details and entries |
| `GET /api/lorebooks/:id/export` | Lorebook/world-info export |
| `DELETE /api/lorebooks/:id` | Remove a standalone lorebook |
| `GET /api/tags` | Tag counts for filters |
| `GET /api/imports` | Import activity |
| `GET /api/imports/status` | Active watcher/import status |
| `GET /api/imports/quarantine` | Quarantined files |
| `POST /api/imports/rescan` | Trigger a full watch-folder rescan |
| `POST /api/imports/quarantine/:id/retry` | Retry a quarantined file |
| `GET /api/settings` | Read watcher settings |
| `PUT /api/settings` | Update watcher settings |
| `POST /api/admin/reindex` | Rebuild the FTS index |

## Architecture

Chartreuse runs as one Node.js process in production:

- Hono serves the HTTP API.
- The built React SPA is served from the backend.
- Chokidar watches card and lorebook folders.
- Imports run through a serial in-process queue.
- Better SQLite3 stores metadata, import state, and FTS indexes.
- Original files, avatars, and quarantined files live under `DATA_DIR`.

The frontend is a React/Vite application using TanStack Query and Tailwind CSS.
Shared API-facing types live in the `shared` workspace package.

## Project Layout

```text
.
|-- server/              # API, importer, watcher, database, tests
|-- shared/              # Shared TypeScript types
|-- web/                 # React/Vite frontend
|-- watch/               # Default local import folders
|-- docker-compose.yml   # Self-hosted runtime
|-- Dockerfile           # Production image
`-- package.json         # Workspace scripts
```
