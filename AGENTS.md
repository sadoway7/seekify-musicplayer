# Seekify

A self-hosted music server: one Go binary plus a vanilla JS/CSS SPA. Point it
at your music and listen in any browser — and when something's missing, rip
it from YouTube or Soulseek, tagged and sorted into your library.

Read the rest of this file as good defaults, not law — a direct instruction
from Sadoway for the task at hand wins. The Hard invariants are the
exception: those are law.

## What makes Seekify special?

People run Seekify on their own servers (Unraid Community Apps, GHCR) — an
unknown number of real installs whose libraries are their data. These are the
things we never compromise on:

### 1. A Spotify you own

The player and the acquisition are one app. Search any track or album, paste
a link or a whole list of songs, and Seekify rips it (yt-dlp for YouTube,
aioslsk for Soulseek), rejects live/wrong versions in favor of the studio
recording, tags from MusicBrainz, and sorts it into Artist/Album/. Streaming
servers (Navidrome, Jellyfin) only play what you bring; rippers (Lidarr) rip
but can't play. Changes that touch the rip → tag → sort → play loop must keep
the loop closed.

### 2. Your music stays yours

Files on disk stay plain files. Tags, artwork and lyrics are written into the
audio files themselves, so anything ripped stays fully tagged if it ever
leaves Seekify. Track/album IDs are stable and persisted everywhere —
favorites, playlists, recents, reviews, caches. Schema migrations are
additive only; an existing production DB must always open cleanly with new
code. Nothing locks in.

### 3. Plays everywhere

Any browser, any format, any network. If the browser can't handle a format
(FLAC on iOS, Dolby/ALAC in Chrome), the server transcodes on the fly; slow
networks retry via transcode. `yt-dlp`, `ffmpeg` and `python3` are optional
at runtime — every fallback path must keep working when they're absent.

### 4. Fast at scale

The whole library lives in memory; the app opens instantly (parallel boot,
ETag 304s, immutable assets, stale-while-revalidate covers). Watch for cover
and home reload storms, N+1 art fetches, and anything that puts blocking work
on the playback path.

## A small glossary

- **you** means the agent reading this file and changing the code.
- **we, us, maintainers** means Sadoway — who you are talking to now.
- **user** means the person using Seekify.
- **rip** means download a track into the library through the Finder pipeline.
- **Finder** means the in-app search/rip UI — the only rip UI.
- **Needs Review** means the queue that auto-flags missing metadata, messy
  names, duplicates, and bad artwork.
- **primary library** means `MUSIC_DIR`; **secondary library** means
  `MEDIA_MUSIC_DIR` (read-only, stored with the `media:` prefix).
- **gate** means a route's auth tier — open, user, or admin. `routes.go` is
  the audit table for which route has which gate.
- **autosort** means moving new files into Artist/Album/ folders.
- **enrich** means filling tags/art/lyrics (Python pipeline, ffmpeg fallback).
- **warm** means pre-generating the transcode cache on ingest.

## The ways to hurt yourself

1. **Pushing to `main` ships to production.** Both CI pipelines fire on push
   to `main`: GitLab rebuilds and redeploys the live Unraid container, GitHub
   publishes `:latest` to GHCR. There is no PR buffer. A bad push is
   immediately running on real servers.
2. **This dev checkout holds real data.** `music/` is a real library;
   `data/` holds the live SQLite DB, rolling 7-day backups, cookies, and the
   transcode cache. Reading is fine. Scanning, deleting, or resetting it is
   not. Tests build their own temp fixtures — never point them here.
3. **Vendor mode.** `go.sum` and `vendor/` are committed and the build runs
   `-mod=vendor`. Running `go mod tidy` or `go get` without also running
   `go mod vendor` and committing `vendor/` breaks the offline build.
4. **The assume-unchanged git trap.** Files flagged assume-unchanged don't
   show in `git diff` and silently won't stage — this has dropped core fixes
   before. Check with `git ls-files -v | grep '^[a-z]'` (lowercase `h` =
   flagged); unflag with `git update-index --no-assume-unchanged <file>`
   before staging, re-flag after. Always verify `git diff --cached --stat`
   shows every intended file.

## Hit every surface

The most common defect here is a change that works on the path you tested
and is missing everywhere else. Before calling frontend or cross-cutting work
done, walk this list and say which entries applied:

- **Entry points.** The SPA (desktop and mobile/PWA layouts — they differ);
  `admin.html` (legacy standalone page, still live, calls `/api/scan`,
  `/api/upload`, `/api/delete`); guest share-links (gate-open
  `/api/shared-queue` — visitors play with no session); the browser
  extension (hits the CORS-any `/api/cookies/*` bridge).
- **Contracts.** API JSON shapes are consumed directly by the SPA,
  `admin.html`, and the extension. Field names, casing, nesting and types
  change only when both sides are updated in the same step and the affected
  UI is verified.
- **Gates.** Three auth tiers (open / user / admin) declared in `routes.go`
  — the single source of truth for routes. Seekify is deployed on trusted
  networks, so open routes really are reachable by anyone; adding or moving
  a route is a security decision.
- **Reverse states.** If you added a way in, add the way out and the way to
  see it. A one-way door is a bug.
- **Docs.** README.md is user-facing; CHANGELOG.md gets every user-facing
  change; `templates/seekify.xml` `<Changes>` renders publicly in Unraid
  (see Shipping for sanitization rules).

## Dev environment

```
go build -mod=vendor -o server .   # build (vendor mode, no network)
./server                            # run; serves on :8081 (PORT env)
```

- Entrypoint is `server.go` (func main). There is no `main.go`.
- Music dir: `-dir` flag or `MUSIC_DIR` (default `./music`, exe-relative).
  `MEDIA_MUSIC_DIR` adds a secondary read-only library.
- `.env` is loaded at startup; real environment variables win.
- `ADMIN_PASSCODE` / `ADMIN_AUTH_ENABLED` lock the settings screen only —
  never the player or the music.
- `air` gives live reload (`.air.toml`, dev-only, builds `./tmp/server`).
- Stop what you started, by the PID or handle you tracked. Don't kill by
  pattern.

## Test data

- Never point tests or experiments at `./music` or `data/` — that is the
  real library and the real DB (see footguns above).
- Go tests build isolated temp fixtures; follow that pattern (see
  `internal/handlers/helpers_test.go`).
- An experiment that needs realistic data gets a snapshot, not a copy:
  `data/music.db` runs WAL, and a plain `cp` of a live database is a
  corrupt copy. Snapshot the live DB with the online backup API:

  ```
  mkdir -p /tmp/seekify-sandbox
  sqlite3 "file:data/music.db?mode=ro" ".backup /tmp/seekify-sandbox/music.db"
  ```

- Copy data in, never symlink. Data flows one way: into your sandbox, never
  back out.

## Verifying

CI never runs tests — the pipelines only validate the CA template XML and
build Docker images. You are the test runner. After every change:

```
go build -mod=vendor ./...    # must succeed
go vet ./...                  # no new warnings
go test ./...                 # must pass
```

- Single test / package: `go test ./internal/store/ -run TestRecent`
- Tracked JS tests (plain `node`, no runner): `js/player.test.mjs`,
  `js/visualizer.test.mjs`, `js/ui-player-chrome.test.mjs`,
  `scripts/home_discovery_test.mjs`, `scripts/player_queue_test.mjs`,
  `scripts/regression_fixes_test.mjs`.
- Never weaken, skip, or delete a test to make a change pass.
- JS has no type checking and no build step — never assume a JS change is
  safe without loading it. For frontend or handler changes, run the app and
  exercise the affected path (library loads, a track streams, the changed UI
  works).
- Review the diff before finishing: only the intended change, no drive-by
  edits.

## Shipping

- No pull requests. Pushes to `main` deploy immediately (see footguns).
  Conventional commit titles, plain language: `fix(scope): what actually
  changed`.
- Every user-facing change (bug fix, feature, UX) gets one line at the top
  of the current CHANGELOG.md block — same commit or immediately after.
- **Unraid CA `<Changes>` is public.** The `<Changes>` field in
  `templates/seekify.xml` renders in the in-Unraid Community Apps panel.
  Never put security-specific details there (path traversal, auth,
  unauthenticated endpoints, input limits, subprocess hardening, audit
  findings). Translate internal changelog entries into benign user-facing
  language ("stability", "bug fixes", "performance"). Security details stay
  in CHANGELOG.md / commit messages only.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch.
  `docs/` is gitignored except `docs/screenshots/` and
  `docs/visualizer-map.md`; `tests/`, `research/`, `data/` are scratch and
  runtime state.
- Durable architecture, constraints and decisions live in this file. Update
  it when reality changes so agents find current facts, not abandoned
  intentions.

## How it works

Scanning (`internal/scanner` reads tags, extracts covers, autosorts, watches
by polling) feeds SQLite (`modernc.org/sqlite`, WAL, `data/music.db`) and an
in-memory library (the Library module in `internal/store`; `LibraryVersion`
is the `/api/library` ETag). The SPA streams via `/api/stream` with on-demand
transcoding (`internal/transcode` caches FLAC→AAC for browsers that need it).
The rip path: Finder search (YouTube scoring + MusicBrainz) → download queue
(`internal/downloads`, yt-dlp and aioslsk via Python) → tag/enrich → autosort
→ the Needs Review worker (`internal/review`) flags problems for inline
fixing. Waveforms, visualizer band timelines, and LUFS normalization are
generated via ffmpeg. Auth is passcode/sessions/users with bcrypt
(`internal/auth`). Two CI pipelines build the same Dockerfile: GitLab deploys
to an Unraid host on push to `main`; GitHub publishes to GHCR.

## Where code lives

- Root `package main` (no `main.go`): `server.go` (startup, HTTP server,
  `wireCrossPackageHooks`), `routes.go` (the declarative route table — paths,
  handlers, gates, methods), `config.go` (`.env` loading), `extension.go`
  (embeds the browser extension as a zip).
- `internal/handlers/` — HTTP API handlers, largest package: library,
  streaming, playback, transcode, downloads, metadata, collections,
  settings, admin, auth, finder, resolve, cookies, custom covers, users,
  workers, uploads. Tests alongside each.
- `internal/store/` — SQLite + the in-memory Library module (all map access
  goes through `View`/`Update` — see invariant 6), settings, covers, paths,
  log buffer.
- `internal/scanner/` — scanning, tag reading, autosort, polling watcher.
- `internal/downloads/` — yt-dlp job queue, YouTube search scoring,
  watchdog; `slsk.go` for Soulseek.
- `internal/musicbrainz/` — MusicBrainz, Cover Art Archive, Deezer art,
  Finder search.
- `internal/review/` — needs-attention worker.
- `internal/watched/` — YouTube playlist watching + auto-download.
- `internal/transcode/` — on-demand FLAC→AAC cache (moov-first, seekable).
- `internal/normalize/` — LUFS loudness gain via ffmpeg ebur128.
- `internal/waveform/`, `internal/bands/` — waveforms and precomputed
  frequency-band timelines for the visualizer.
- `internal/auth/`, `internal/models/` — users/sessions; data structs and ID
  generation (`models/ids.go`).
- `index.html` + `js/` + `css/` — the SPA. No framework, no ES modules, no
  build step; each JS file is a `<script>` tag attaching methods onto shared
  globals (`UI`, `Store`, `Player`, `Api`). Load order in `index.html` is the
  source of truth — new tags must slot into it correctly.
- `extension/musicapp-cookies/` — companion browser extension (embedded).
- `lists/`, `scripts/` — genre seed lists; `enrich.py` / `soulseek_dl.py`,
  start/stop helpers, and the tracked `.mjs` tests.
- `vendor/` — committed dependency tree, read-only.

## Hard invariants — never change these

These are data contracts. Breaking them corrupts user data or breaks clients
even if the code "looks better" afterward.

1. **ID generation.** Track ID = `SHA-256(filePath)[:12]`. Album ID =
   `SHA-256(lower(artist|album))[:12]`. IDs are persisted in favorites,
   playlists, recents, reviews, download jobs, and cover/waveform cache
   filenames. Changing the algorithm, input normalization, or truncation
   orphans existing user data. If a task seems to require changing this,
   **stop and confirm** — it needs a data migration plan, not a code edit.
2. **Path prefix scheme.** Secondary-library paths are stored with a
   `media:` prefix; primary paths have none. The stored format feeds ID
   generation — preserve it exactly.
3. **`dbUpsertTrack` preserves tag fields when `has_metadata = 1`** so the
   scanner doesn't clobber user-approved metadata. This asymmetry is
   intentional.
4. **API JSON shapes.** The frontend consumes `/api/*` responses directly.
   Field names, casing, nesting, and types change only when both sides are
   updated in the same step and the affected UI is verified.
5. **Schema migration style:** additive only — `CREATE TABLE IF NOT EXISTS` +
   `ALTER TABLE ADD COLUMN`. No migration frameworks, no column renames, no
   semantic changes. An existing production DB must open cleanly with new
   code.
6. **Concurrency.** The in-memory track/album maps are package-private
   inside `internal/store` and only reachable through the Library module
   (`internal/store/library.go`): `store.View`/`store.Update` callbacks
   (lock spans preserved verbatim; Update writes rebound `l.Tracks`/
   `l.Albums` back under the same lock), plus sugar (`GetTrack`, `GetAlbum`,
   `AllTracks`, `TrackCount`, `AlbumCount`, `ReplaceLibrary`) — never call
   the sugar inside a View/Update callback (the RWMutex is not reentrant).
   Cover/artist-art caches remain separately guarded (`CoverMu`,
   `ArtistArtMu`); the established lock order is Mu→CoverMu. Cross-package
   hooks (scanner/review/downloads seams) are wired in exactly one place:
   `wireCrossPackageHooks()` in server.go. Preserve exact locking behavior;
   never leak map references outside existing lock patterns; treat any
   lock-ordering change as high risk and call it out.
7. **Startup behavior.** DB-to-memory load order and the optimistic
   scan-skip (matching file counts → skip rescan) stay as-is.
8. **Graceful degradation.** `yt-dlp`, `ffmpeg`, and `python3` are optional
   at runtime. Preserve every fallback (Python enrichment → ffmpeg tagging;
   cover chain ending in SVG placeholder).

## Taste

- Keep diffs scoped to the task. No drive-by cleanup, reformatting, or
  "while I'm here" changes in unrelated code — propose those separately.
- One concern per change. Don't mix a refactor with a bug fix or a feature;
  sequence them as separate, individually verified steps.
- Follow existing patterns (handler style, mutex discipline, Store/UI module
  shape) rather than introducing new ones. No new Go dependencies without
  approval; no new frontend frameworks, libraries, or build steps.
- Refactors are behavior-preserving, mechanical, verbatim-move-first — if
  unsure whether a refactor changes behavior, stop and ask.
- Bug fixes state old behavior, new behavior, and add a regression test
  where the logic is testable.
- Moving `.go` files between packages changes import paths — get approval
  first. New `<script>` tags in `index.html` must respect load order.
- Don't touch `Dockerfile`, CI, ports, volumes, env vars, or admin auth
  unless explicitly asked.
- If a rule here fights the task in front of you, say so loudly and get a
  human sign-off before breaking it.

## Additional tips

- The SPA catch-all route serves `index.html` for any non-`/api/` path.
- `data/`, `*.db`, `music/`, `tests/`, `node_modules/`, `.air.toml`,
  `docs/` (except `docs/screenshots/`), `research/` are gitignored — runtime
  and scratch only. Never commit runtime state.
- Contributions may come from an agent running unattended. Be careful with
  anything that could damage an environment someone else is actively using.
