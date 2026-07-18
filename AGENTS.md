AGENTS.md

# Seekify

Self-hosted music server: Go backend (single binary) + vanilla JS/CSS SPA frontend. Scans local music dirs, streams audio, downloads via yt-dlp (YouTube) and aioslsk (Soulseek, via Python), fetches MusicBrainz metadata, generates waveforms via ffmpeg, writes tags via mutagen.

## Build & Run

```
go build -mod=vendor -o server .   # build (vendor mode, no network)
./server                            # run; serves on :8081 (PORT env)
go run .                            # build + run in one step
```

The binary auto-opens a browser. Music dir is set by `-dir` flag or `MUSIC_DIR` env (defaults to `./music`, or exe-relative `./music`).

Dev live reload with `air` (config in `.air.toml`, gitignored/dev-only): builds to `./tmp/server` and reruns on change.

## Architecture

Go module `musicapp`, Go 1.26. **No `main.go` — entrypoint is `server.go` (func main).**

Root `.go` files are `package main`: `server.go` (startup, flags, routes, HTTP server, middleware, loads `.env`), `config.go` (hand-rolled `loadDotEnv` — real env vars win over `.env`), `extension.go` (`//go:embed extension/musicapp-cookies`, serves the companion browser extension as a zip).

Business logic lives under `internal/` (each is its own package):

- `handlers/` — HTTP API handlers (largest package: `library.go`, `streaming.go`, `downloads.go`, `metadata.go`, `collections.go`, `settings.go`, `admin.go`, `auth.go`, `finder.go`, `resolve.go`, `cookies.go`, `custom_cover.go`, `download_limits.go`, `library_upload.go`, `users.go`, `workers.go`, `register.go`). Many `*_test.go`.
- `store/` — SQLite via `modernc.org/sqlite` (pure-Go, no CGo), WAL mode; `database.go`, `store.go`, `settings.go` (key-value), `covers.go`, `paths.go`, `logbuf.go`, `safego.go`. `internal/store/tmpverify/` and `dedup_verify_test.go` are gitignored scratch — not part of the build.
- `scanner/` — music file scanning, tag reading, embedded cover extraction (`scanner.go`), `autosort.go` (moves files into Artist/Album/), `watcher.go` (polling watcher, file counts not fsnotify).
- `downloads/` — yt-dlp job queue, YouTube search scoring, watchdog; `slsk.go` (Soulseek via Python `aioslsk`).
- `musicbrainz/` — MusicBrainz lookup, Cover Art Archive, Deezer artist art, Finder search.
- `review/` — track review worker: auto-flags missing metadata, suspicious names, duplicates, duration anomalies.
- `watched/` — YouTube playlist watching + auto-download.
- `waveform/` — waveform generation via ffmpeg.
- `auth/` — passcode auth, sessions, users (bcrypt via `golang.org/x/crypto`).
- `models/` — data structs (`Track`, `Album`, `Playlist`), `ids.go` (ID generation — see Hard invariants), `genre.go`.

Frontend: `index.html` (SPA), `admin.html` (legacy standalone admin page), `ripperv2.html` (standalone ripper page). `js/` is vanilla JS, **no framework, no ES modules, no build step** — each file is a `<script>` tag attaching methods onto shared global objects (`UI`, `Store`, `Player`, `Api`). **Load order in `index.html` matters** (icons → api → player → store → review → ui → ui-* modules → ripperv2 → keyboard → visualizer → app). Largest frontend files: `js/ui.js` (base + DOM), then `js/ui-settings.js`, `js/ui-library.js`, `js/ui-finder.js`, `js/ui-context-menus.js`, `js/ui-player-chrome.js`, `js/ui-waveform.js`, `js/ui-home.js`. `css/` is plain CSS aggregated by `css/styles.css` (import order matters). Served as static files by the Go server; the SPA catch-all serves `index.html` for any non-`/api/` path.

`extension/musicapp-cookies/` — companion browser extension, embedded via `extension.go`.

## Database

`data/music.db` (SQLite, auto-created on first run, gitignored). Schema migrations are **additive only**: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`. No migration frameworks, no column renames, no semantic changes. An existing production DB must open cleanly with new code.

## Dependencies

Go (vendor mode required — `vendor/` and `go.sum` committed; do not run `go mod tidy` or `go get` without also running `go mod vendor` and committing `vendor/`):
- `github.com/dhowden/tag` (audio tag reading)
- `modernc.org/sqlite` (pure-Go SQLite, no CGo)
- `github.com/google/uuid`
- `golang.org/x/crypto` (bcrypt for admin auth)

Runtime external tools (optional but expected in Docker): `yt-dlp`, `ffmpeg`, `python3` (Soulseek via `aioslsk`, enrichment via `scripts/enrich.py`). Graceful degradation preserves every fallback path when these are absent.

No new Go dependencies without approval; no new frontend frameworks/libraries or build steps.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `MUSIC_DIR` | Primary music directory | `./music` |
| `MEDIA_MUSIC_DIR` | Secondary read-only library (stored with `media:` prefix — feeds ID generation) | (none) |
| `PORT` | HTTP listen port | `8081` |
| `ADMIN_PASSCODE` | Passcode locking the settings screen only (not player/music) | (none) |
| `ADMIN_AUTH_ENABLED` | Require passcode before settings | `false` |

`.env` is loaded by `loadDotEnv` at startup; real env vars override it.

## Hard invariants — never change these

These are data contracts. Breaking them corrupts user data or breaks clients even if the code "looks better" afterward.

1. **ID generation.** Track ID = `SHA-256(filePath)[:12]`. Album ID = `SHA-256(lower(artist|album))[:12]`. IDs are persisted in favorites, playlists, recents, reviews, download jobs, and cover/waveform cache filenames. Changing the algorithm, input normalization, or truncation orphans existing user data. If a task seems to require changing this, **stop and confirm** — it needs a data migration plan, not a code edit.
2. **Path prefix scheme.** Secondary-library paths are stored with a `media:` prefix; primary paths have none. The stored format feeds ID generation — preserve it exactly.
3. **`dbUpsertTrack` preserves tag fields when `has_metadata = 1`** so the scanner doesn't clobber user-approved metadata. This asymmetry is intentional.
4. **API JSON shapes.** The frontend consumes `/api/*` responses directly. Field names, casing, nesting, and types change only when both sides are updated in the same step and the affected UI is verified.
5. **Schema migration style:** additive only (see Database).
6. **Concurrency.** Global maps (tracks, albums, cover/artist-art caches) are `sync.RWMutex`-guarded and accessed by HTTP handlers plus background goroutines (watcher, download queue, review worker, schedulers). Preserve exact locking behavior; never leak map references outside existing lock patterns; treat any lock-ordering change as high risk and call it out.
7. **Startup behavior.** DB-to-memory load order and the optimistic scan-skip (matching file counts → skip rescan) stay as-is.
8. **Graceful degradation.** `yt-dlp`, `ffmpeg`, and `python3` are optional at runtime. Preserve every fallback (Python enrichment → ffmpeg tagging; cover chain ending in SVG placeholder).

## Testing & verification

Go tests live alongside code as `*_test.go` (23 tracked test files across `internal/` + `server_test.go`). Never weaken, skip, or delete a test to make a change pass. After every change:

```
go build -mod=vendor ./...    # must succeed
go vet ./...                  # no new warnings
go test ./...                 # must pass
```

Run a single test / package: `go test ./internal/store/ -run TestRecent`.

JS has **no type checking or build step** — never assume a JS change is safe without loading it. Tracked JS tests (run with `node` directly, no test runner): `js/player.test.mjs`, `js/visualizer.test.mjs`, `scripts/home_discovery_test.mjs`, `scripts/player_queue_test.mjs`. Note: `tests/` is **gitignored** (scratch); the tracked `.mjs` tests are in `js/` and `scripts/`.

For frontend or handler changes: run the app and manually exercise the affected path (library loads, a track streams, the changed UI works). Review the diff: only the intended change, no drive-by edits.

## Working style

- Keep diffs scoped to the task. No drive-by cleanup, reformatting, or "while I'm here" changes in unrelated code — propose those separately.
- One concern per change. Don't mix a refactor with a bug fix or a feature in the same step; sequence them as separate, individually verified steps.
- Adding/splitting files within `internal/<pkg>/` or root `package main` is fine. Moving `.go` files between packages changes import paths — get approval first. New `<script>` tags in `index.html` must respect load order (shared global scope, no module system, no ES imports).
- Don't touch `Dockerfile`, CI, ports, volumes, env vars, or admin auth unless explicitly asked.
- Update `CHANGELOG.md` with every user-facing change (bug fix, feature, UX change): one line at the top of the `Unreleased`/`Looking at` block. Commit in the same commit or immediately after.

### Task-specific

- **Refactoring:** behavior-preserving, mechanical, verbatim-move-first. If unsure whether a refactor changes behavior, stop and ask.
- **Bug fixes:** changing behavior is the point — state old behavior, new behavior, and add a regression test where the logic is testable.
- **Features:** new API routes, additive columns, settings keys, and UI are fair game within the invariants. Follow existing patterns (handler style, mutex discipline, Store/UI module pattern) rather than introducing new ones.

## Deployment

Two CI pipelines publish the same Dockerfile:
- `.gitlab-ci.yml` — builds `musicapp` image, deploys to an Unraid host on push to `main`.
- `.github/workflows/docker-publish.yml` — pushes `seekify` image to GHCR (`unraid/templates/seekify.xml` pulls `ghcr.io/sadoway7/seekify:latest`).

Docker image: `golang:1.26-alpine` build → `alpine` runtime with `python3`, `ffmpeg`, `pip install yt-dlp mutagen musicbrainzngs lyriq requests aioslsk`. Production mounts: `/app/data` (DB), `/music` (primary), `/media-music` (secondary). Exposed port `8081` (mapped to `8298` in GitLab CI).

## Gotchas

- **No `main.go`.** Entrypoint is `server.go`.
- **Vendor mode required.** `go.sum` and `vendor/` are committed. Don't run `go mod tidy` or `go get` without also running `go mod vendor` and committing `vendor/`.
- **`data/`, `*.db`, `music/`, `tests/`, `node_modules/`, `.air.toml`, `docs/` (except `docs/screenshots/`), `internal/store/tmpverify/`, `internal/store/dedup_verify_test.go` are gitignored** — runtime/scratch only.
- **SPA catch-all route** serves `index.html` for any non-`/api/` path.
- **Git assume-unchanged trap.** Four tracked files are flagged assume-unchanged: `css/finder.css`, `internal/handlers/handlers.go`, `internal/store/migrate_legacy_test.go`, `ripperv2.html`. Edits to a flagged file are invisible to `git diff` and silently won't stage. Before staging such an edit, run `git update-index --no-assume-unchanged <file>`, then re-flag after commit. Check one file: `git ls-files -v <file>` (lowercase `h` = flagged, `H` = clean). List all: `git ls-files -v | grep '^[a-z]'`. Always verify `git diff --cached --stat` shows every intended file before committing — this has silently dropped core fixes before.