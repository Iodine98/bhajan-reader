# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dependencies

Python dependencies are managed with [uv](https://docs.astral.sh/uv/). After cloning:

```bash
cd backend && uv sync          # installs all dependencies into .venv
```

Current dependencies: `SpeechRecognition` (server-side transcription fallback for Firefox).

## Running the app

```bash
cd backend && uv run python3 server.py   # starts http://localhost:8080 with hot-reload
```

No build step, no npm. The frontend is vanilla JS. Edit any `.js`, `.html`, `.css`, or `.bhajan` file and the browser reloads automatically via SSE.

## Running with Docker

```bash
docker compose up --build   # frontend → http://localhost, backend on internal port 8080
docker compose down
```

The frontend Nginx container (`frontend/Dockerfile`) proxies `/api/*` and `/translations/*`
to the backend container (`backend/Dockerfile`). See `frontend/nginx.conf` for proxy rules.
`docker-compose.yml` exposes only port 80 (frontend); the backend is internal.

## Deployment

Two independent workflows trigger on push to `main`:

| Workflow | Trigger path | What it does |
|---|---|---|
| `deploy-frontend.yml` | `frontend/**` | Generates `config.js` from `TAILSCALE_BACKEND_URL` secret, FTP-deploys to Hetzner |
| `deploy-backend.yml` | `backend/**` | Builds and pushes `ghcr.io/iodine98/bhajan-reader-backend:latest` to GHCR |

For local dev against a remote backend, copy `frontend/config.example.js` →
`frontend/config.js` and fill in the Tailscale URL. Without it, API calls use
relative paths (works with `docker compose` or `server.py` directly).

## Running tests

Playwright (E2E, requires server running):

```bash
cd backend
uv run pip install playwright pytest && playwright install chromium
uv run pytest tests/test_theme.py -v          # all theme tests
uv run pytest tests/test_theme.py::TestThemeToggle::test_click_switches_to_light  # single test
```

## Architecture

**No framework, no bundler.** The frontend is vanilla ES6 modules served as-is. `app.js` is the entry point that imports from `modules/` and wires everything together.

### Data flow

1. User uploads a `.bhajan` file → `parser.js` → raw `{ meta, verses[{ id, lines[] }] }`
2. `translator.js` resolves translations (see caching below) → translated doc `{ meta, verses[{ id, phrases[{ sa, rom, en, nl }] }] }`
3. `renderer.js` pre-renders all `<span class="word" data-word-index="N">` elements for both panels at load time
4. User input (keyboard / mic onset) → `cursor.js` advances position → `renderer.onCursorUpdate()` toggles a CSS class on one span per panel (no DOM rebuild)
5. Every cursor change is also broadcast via `BroadcastChannel` to sync the audience display window (`?mode=display`)

### Key modules

| Module | Role |
|---|---|
| `app.js` | Entry point. `handleText(text)` is the shared loading path used by both the file-picker and the examples dropdown. |
| `cursor.js` | Single source of truth for position. Pub/sub: register callbacks with `cursor.on(fn)`. Maintains a flat phrase list across all verses. |
| `renderer.js` | Sanskrit panel has two sub-rows: `.sa-row` (Devanagari) and `.rom-row` (IAST). Both share `data-word-index`, so one selector highlights both simultaneously. |
| `translator.js` | Calls Claude via the server proxy. Bump `CACHE_VERSION` constant when changing the prompt or expected JSON schema to invalidate old cached translations. |
| `audio.js` | RMS onset detection. Configurable `threshold` (ratio over background) and `refractoryMs` (min gap between onsets). |
| `broadcast.js` | Only the operator window emits; `?mode=display` windows are read-only listeners. |
| `server.py` | Serves static files + proxies `POST /api/anthropic` → Anthropic API + handles `POST /translations/{hash}.json` + `POST /api/transcribe` for server-side speech recognition (Firefox fallback, requires `SpeechRecognition`). |

### Translation caching (three tiers)

1. `sessionStorage` — instant, same browser session
2. `GET /translations/{sourceHash}.json` — persisted on disk across sessions
3. Claude API — called only on cache miss; result auto-saved to disk via `POST /translations/{hash}.json`

The cache key is a hash of the raw Sanskrit lines, not the filename. Same Sanskrit = same cached translation.

## .bhajan file format

```
# title: Gayatri Mantra
# composer: Vishwamitra
---
[verse:1]
ॐ भूर्भुवः स्वः
तत्सवितुर्वरेण्यं
---
```

Each line under a `[verse:N]` marker becomes one **phrase**. A phrase is the atomic unit: `cursor.wordIndex` advances through the words within a phrase, and `cursor.globalPhraseIndex` advances through phrases across the whole document.

## Non-obvious constraints

- **Word count alignment**: `sa`, `rom`, `en`, `nl` arrays within a phrase should have the same length. If Claude returns misaligned counts, highlighting will be off. The renderer uses `data-word-index` positionally.
- **Display mode is passive**: `?mode=display` windows cannot load files or change settings — they only mirror BroadcastChannel messages from the operator window.
- **`CACHE_VERSION` in `translator.js`**: Must be bumped manually if the Claude prompt or JSON schema changes, to invalidate old translations stored in `sessionStorage` and `translations/`.
- **Hot reload watches**: `.html`, `.css`, `.js`, `.bhajan` only. Changes to `.json` files in `translations/` won't trigger a browser reload.
- **API key storage**: Stored in `localStorage` only. Never sent to or stored by `server.py`.
- **Mic requires a secure context**: `navigator.mediaDevices` is `undefined` over plain HTTP on non-localhost. Both `audio.js` and `speech.js` guard against this and throw a human-readable error. Test mic features via `localhost` or HTTPS only.
- **Upload/Export live in the Settings modal, not the toolbar**: The header toolbar has no file buttons. The "Load Bhajan" section (examples dropdown + "Open file…") and "Export" section are the first two groups inside `<dialog id="settings-modal">`.
