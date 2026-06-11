# AGENTS.md

## Project

Self-hosted music server: Go backend (`package main`, single binary) serving a vanilla JS/CSS SPA frontend. Scans local music directories, streams audio, downloads via yt-dlp, fetches metadata from MusicBrainz.

## Build & Run

```sh
go build -mod=vendor -o server .   # build (vendor mode, no network)
./server                            # run; serves on :8081
go run .                            # build+run in one step
```

The binary auto-opens a browser. Use `-dir` flag or `MUSIC_DIR` env var to set the music directory (defaults to `./music`).

## Architecture

- **Single Go package** — all `.go` files at repo root are `package main`, compiled into one binary.
- **Entrypoint:** `server.go` (`func main()`). No separate `main.go`.
- **Key files:**
  - `server.go` — startup, flag parsing, route registration, HTTP server
  - `handlers.go` — HTTP API handlers (~2100 lines)
  - `database.go` — SQLite via `modernc.org/sqlite` (no CGo), WAL mode
  - `scanner.go` — music file scanning and tag reading
  - `watcher.go` — filesystem watcher for live library updates
  - `downloads.go` — yt-dlp download jobs
  - `musicbrainz.go` — MusicBrainz metadata lookup
  - `waveform.go` — audio waveform generation
  - `models.go` — data structs (Track, Album, Playlist, etc.)
  - `settings.go` — app settings stored in SQLite
  - `state.go` — shared state helpers
  - `review.go` — track review worker: auto-flags tracks with missing metadata, suspicious names, duplicates, duration anomalies
  - **Frontend:** `index.html`, `js/` (vanilla JS, no framework), `css/` (plain CSS). Served as static files by the Go server.
    - `js/review.js` — ReviewUI module: now-playing overlay, edit metadata modal, review actions
    - `css/review.css` — review-specific styles (overlay, modal, flags, page header)
- **Database:** `data/music.db` (SQLite, auto-created on first run, gitignored).

## Dependencies

- Go module: `musicapp` (Go 1.26)
- Vendor directory committed (`vendor/`). Always use `-mod=vendor` or rely on the vendor dir.
- Key libraries: `github.com/dhowden/tag` (audio tag reading), `modernc.org/sqlite` (pure-Go SQLite).
- Runtime external tools (optional but expected in Docker): `yt-dlp`, `ffmpeg`.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `MUSIC_DIR` | Primary music directory | `./music` |
| `MEDIA_MUSIC_DIR` | Secondary (read-only) music directory, mounted as `media:` prefix | (none) |
| `PORT` | HTTP listen port | `8081` |

## Testing

No test files exist yet. No lint or formatter config.

## Deployment

- GitLab CI (`.gitlab-ci.yml`): builds Docker image, deploys container on push to `main`.
- Docker image: builds with `go build -mod=vendor`, runs on Alpine with `python3`, `ffmpeg`, `yt-dlp` pre-installed.
- Production mounts: `/app/data` (DB), `/music` (primary library), `/media-music` (secondary library).
- Exposed port in Docker: `8081` (mapped to `8298` in CI config).

## Conventions

- All Go code is a single `main` package — no subpackages, no internal packages.
- Global state: in-memory maps (`tracks`, `albums`, `coverCache`) protected by `sync.RWMutex`.
- SQLite used for persistence (favorites, playlists, metadata matches, settings, download jobs).
- File paths in the library use a `prefix:path` scheme for multi-directory support (e.g., `media:some/file.flac`).
- No generated code, no migrations framework — schema is applied via `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` at startup.

## Gotchas

- There is no `main.go` file. The entry point is `server.go`.
- Vendor mode is required. The `go.sum` and `vendor/` are committed. Do not run `go mod tidy` or `go get` without also running `go mod vendor`.
- `data/` directory and `*.db` files are gitignored — they are runtime-only.
- The `music/` directory contains test audio data (also gitignored for most content).
- The `old app/` and `reference apps/` directories are legacy/reference only — do not modify.
- The SPA catch-all route serves `index.html` for any non-`/api/` path.
