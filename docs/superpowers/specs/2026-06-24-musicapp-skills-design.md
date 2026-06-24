# musicapp skills — design spec

**Date:** 2026-06-24
**Status:** Approved (brainstormed 2026-06-24)
**Author:** brainstorming session with user

## Purpose

Five project-level skills that act as **guardrails, guides, and feature-expansion aids** for the musicapp codebase. They auto-invoke when a change touches a matching area, enforcing consistent design/UX/code patterns and surfacing the hard invariants that protect user data.

The skills are **not** for greenfield new-feature invention; they guide and constrain changes to the existing app — including feature expansion within established conventions.

## Context

musicapp is a self-hosted music server: Go backend (single binary, SQLite, vendor mode) + vanilla JS/CSS SPA (no build step). Dark-mode-first, single lime accent (`#D4F040`), album-art-forward. A Spotify/Apple-Music-style player bolted to an old-school LimeWire/Napster-style ripper/finder. 14 hard invariants — breaking them corrupts user data or breaks clients.

The codebase has been refactored from "all `.go` at repo root" into `internal/{downloads,handlers,models,musicbrainz,review,scanner,store,watched,waveform}`; only `server.go` remains at root (`package main`). AGENTS.md's file-layout description is stale on this point but its invariants still hold.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Skill purpose | Guardrails + guides + feature expansion (not new features) |
| Scope split | By change type: visual / interaction / data-contract / backend / cross-cut |
| Location | Project-level: `.opencode/skills/musicapp-*/SKILL.md` (versioned with the app) |
| Trigger style | Auto-invoke on matching file paths / work areas |
| Naming | Descriptive: `musicapp-visual`, `musicapp-interaction`, `musicapp-data`, `musicapp-backend`, `musicapp-cross-cut` |
| Approach | **A — Tight guardrails**: five lean skills (~150-250 lines each) with cross-references. Invariants live canonically in `cross-cut`; the other four excerpt subsets. |

## Shared structure

Each `SKILL.md` follows this shape:

```
---
name: musicapp-<area>
description: <one-line trigger description for the skill index>
---

# musicapp-<area> — <area> guardrails

## When to load
<file-path triggers — which paths/files fire this skill>

## The app in 30 seconds
<shared 3-line elevator pitch so each skill is grounded>

## Invariants that matter here
<the subset of the 14 hard invariants relevant to this area, with file:line refs>

## Do / Don't
<area-specific rules, each with a file:line anchor>

## Patterns to follow
<the existing conventions to mimic, with examples>

## Gotchas
<footguns specific to this area>

## See also
<cross-refs to sibling skills for overlaps>
```

**Trigger mechanism:** opencode's skill router matches the frontmatter `description` against the current task. The `description` field must therefore name the file paths / work areas in prose (e.g. "Use when editing css/, js/icons.js, or UI markup in js/ui.js — visual/design-language guardrails for the musicapp SPA"). The "When to load" section inside each skill is human guidance that mirrors the description; both must stay in sync. Auto-invoke means the router loads the skill before I act on matching work — I don't wait to be asked.

**Shared elevator pitch** (identical in all five):

> Self-hosted music server: Go backend + vanilla JS/CSS SPA. Dark-mode-first, single lime accent (#D4F040), album-art-forward. A Spotify/Apple-Music-style player bolted to an old-school LimeWire/Napster-style ripper/finder. Single binary, SQLite, no build step. 14 hard invariants — breaking them corrupts user data.

**Cross-reference rule:** When a rule belongs to two areas (e.g. a UI change that shifts an API shape), the skill names the sibling in "See also" rather than duplicating. `cross-cut` is the canonical home for the full invariant list; the other four excerpt only what's directly relevant.

## Skill 1 — musicapp-visual

**Triggers:** editing `css/**`, `index.html`/`admin.html`/`ripperv2.html` style portions, `js/icons.js`, or any `UI._render*`/markup-building code in `js/ui.js`.

**Invariants that matter here:**
- API JSON shapes don't change from visual work (cross-ref musicapp-data)
- No new frontend frameworks/build steps/libraries
- No web fonts; system stack only

**Do / Don't:**
- ✅ Use the `:root` tokens in `css/base.css:1-95` — never hardcode hex. The ladder `--bg`→`--l1..l4` is the luminance system; accent is `--accent #D4F040` with soft/glow/dim variants.
- ✅ Mimic existing component classes: `.card` (112×112), `.scroll-row` (snap-x), `.modal-sheet` (bottom sheet + `.modal-handle`), `.chip`/`.lib-tab` (pill, active→accent bg), `.toast`, `.skeleton`, `.stat-badge`.
- ✅ Every tappable element gets a `transform`/`opacity` transition + `:active` scale 0.92–0.97 (`base.css:157-168`). Honor `prefers-reduced-motion` (`base.css:185-194`).
- ✅ Dynamic theming = album-art dominant color recolors `<meta theme-color>` + `#np-bg-glow` (`ui.js:7068`). Extend this pattern, don't add a second theming system.
- ✅ Icons = inline SVG, `stroke="currentColor" stroke-width="2"`, 24×24 viewBox. Use `js/icons.js` helpers for JS-generated markup.
- ❌ Don't add a light theme or `prefers-color-scheme` switching — the app is dark-only by design.
- ❌ Don't introduce web fonts, CSS preprocessors, or build steps.
- ❌ Don't use the `admin.html` inline style as a reference — it's a pre-design-system outlier; follow `css/` tokens instead.

**Patterns to follow:**
- New screen → hero header + `.scroll-row` carousels or track list; see `renderHome`/`renderAlbum` in `ui.js`.
- New modal → `.modal-sheet` bottom sheet with `.modal-handle`, slide-up animation (`modals.css:1-15`).
- New status indicator → `.stat-badge` or `.finder-status-badge` with `dot-waiting/failed/done`.
- Spacing: 4px scale `--sp-1..8` (4/8/12/16/20/24/32/48). Radii `--radius-xs..xl` (6/8/12/16/20). Page gutter `--page-margin 20px`.

**Gotchas:**
- `css/styles.css` is an `@import` aggregator; `review.css`/`ripperv2.css` are also `<link>`ed separately in `index.html:11-12` (slightly redundant — don't remove without checking load order).
- `js/ui.js` is a 7141-line monolith doing all DOM via string concatenation + `innerHTML` + `addEventListener` delegation. Match that style; don't introduce a templating library.
- The `<meta theme-color>` and `#np-bg-glow` are the *only* adaptive theming — don't build a parallel system.

**See also:** musicapp-interaction (flows that render UI), musicapp-cross-cut (a11y contrast checks).

## Skill 2 — musicapp-interaction

**Triggers:** editing `js/ui.js` view/flow logic, `js/player.js`, `js/review.js`, `js/app.js`, `js/ripperv2.js`, or `index.html` modal/overlay markup; any change to a user journey, state, or feedback.

**Invariants that matter here:**
- `Store` is the single source of truth; `Player` is independent state with callbacks into `UI` (don't invert this)
- No event bus — modules communicate via direct method calls and callback properties
- API JSON shapes don't change from interaction work (cross-ref musicapp-data)

**Do / Don't:**
- ✅ Route new views through `UI.navigateTo(view, data)` (`ui.js:1152`) which pushes `_navHistory`; `UI.navigateBack()` pops. Don't invent a parallel router.
- ✅ Wire events with `addEventListener` + `element.closest('.class')` delegation (`_bindContentEvents`, `ui.js:863-1150`). This is the house style.
- ✅ Use `UI.showToast(msg)` for user feedback; `UI.showToast` is the only toast channel.
- ✅ Player wiring goes through callback properties (`Player.onStateChange`, `onTrackChange`, `onQueueChange`) set in `app.js:5-30` — extend these, don't add a second listener system.
- ✅ Queue panel = swipe-up + drag-to-reorder (`ui.js:641-781`). Match the gesture pattern for new draggable surfaces.
- ✅ Modal = `.modal-sheet` bottom sheet; render into the existing overlay slots in `index.html` (`#playlist-modal`, `#edit-meta-modal`, etc.) before adding new ones.
- ✅ Deep links (`?play=`, `?q=`, `?artist=`, `?album=`, `?playlist=`) handled in `app.js:57-107` — add new params there.
- ❌ Don't use inline `onclick="ReviewUI.*"` for new code — it's a legacy exception only in `index.html` for the review overlay (`index.html:119,212,216,221,225,254,262,297`). Use `addEventListener` instead.
- ❌ Don't block the UI on fetch — `Api.*` throws on `!res.ok`; callers `try/catch` + `UI.showToast`. Read paths return safe defaults (`null`/`[]`) to keep the UI resilient.
- ❌ Don't add a new global singleton — the 8 modules (`Icons`/`Api`/`Player`/`Store`/`ReviewUI`/`UI`/`RipperV2`/`App`) are the complete set; extend an existing one.

**Patterns to follow:**
- **Now-playing flow:** tap track → `Player.play(track, trackList, source)` → mini-player docks above tab bar → tap expands `#now-playing` full-screen (`UI.showNowPlaying`). Seek via waveform canvas (multiple paint styles, `ui.js:4400-4613`).
- **Finder hunt (the LimeWire flow):** `renderFinder` (`ui.js:2538`) — three sub-tabs (Rip Search / YT Import / Downloads). Search → MB candidate drill-down → YouTube match scoring → `POST /api/queue/add` → poll queue every 3-5s → completed job → jump to album. Standalone variant in `ripperv2.js` (URL-resolve + batch).
- **Review workflow:** background worker auto-flags tracks (16 flag types, `review.js:88-105`); they surface on Home "Needs Review", the `needs-review` view, and **inline in now-playing** (`#np-review-overlay`). Quick actions: mark-ok, rescrape, edit-meta, delete. Delete is destructive (removes file from disk) — always confirm via the custom dialog.
- **Home layout:** configurable carousels from `Store.defaultHomeLayout` (`store.js:16-24`); editable via drag-to-reorder modal (`ui.js:5105-5418`).

**Gotchas:**
- `Search` and `Favorites` tabs are `display:none` by default (`index.html:51,55`) — they appear only when activated via the home search bar / favorites section. Non-obvious discovery model; don't "fix" it without asking.
- Review overlay uses inline `onclick` while the rest uses `addEventListener` — known inconsistency, don't spread it.
- `Player` skips unavailable files after `_consecutiveErrors` cap (`player.js:122-149`); 10s load timeout (`player.js:110`). Preserve this resilience.
- Polling: queue every 3-5s (`ripperv2.js:17-20`), library version every few seconds (`app.js:112-138`). Match polling cadences; don't add tight loops.
- Media Session API integration (`player.js:48-69`) powers lock-screen controls — keep it working when touching player code.

**See also:** musicapp-visual (component classes for new flows), musicapp-data (API shapes the flows call), musicapp-cross-cut (a11y for keyboard/screen-reader, MediaSession).

## Skill 3 — musicapp-data

**Triggers:** editing `internal/models/models.go`, any handler returning JSON (`internal/handlers/*.go`), `js/api.js`, or `js/store.js`; any change to an `/api/*` endpoint shape, a struct tag, or how the frontend consumes a response.

**Invariants that matter here (the core of this skill):**
- **API JSON shapes are a hard contract.** Field names, casing, nesting, and types only change when both sides update in the same step and the affected UI is verified. (AGENTS.md invariant #4)
- `Store` is the single source of truth on the frontend; `Api.*` is the only fetch layer.
- camelCase JSON via struct tags (`albumID`, `trackIds`, `reviewFlags`, `hasMetadata`, etc.) — per `models.go`.

**Do / Don't:**
- ✅ When adding a field: add the struct tag in `models.go`, emit it from the handler, and consume it in `js/api.js`→`js/store.js`→`js/ui.js` **in the same change**. Verify by loading the affected UI.
- ✅ New endpoint → register in `server.go:193-314`, handler in `internal/handlers/`, response struct in `models.go`. Follow the existing grouping (library / streaming / collections / finder / downloads / metadata / review / settings).
- ✅ Frontend read paths return safe defaults (`null`/`[]`) on failure (`api.js:39-44,620-636`) — keep the UI resilient. Write paths throw → caller `try/catch` → `UI.showToast`.
- ✅ Use XHR only where upload progress is needed (`api.js:60-75,78-106`); otherwise `fetch`.
- ✅ Cover/version-busting via `Api.coverUrl`/`Api.bustCover` helpers — don't invent cache-busting.
- ✅ Library version is `atomic.Int64` `LibraryVersion` (`library.go:15`); frontend polls `/api/stats` to decide refetch (`app.js:112-138`). Bump it on any library change.
- ❌ Don't rename an existing JSON field — the frontend breaks silently. If a rename is truly needed, add the new field alongside, migrate consumers, then remove the old in a separate step.
- ❌ Don't change a field's type (e.g. `string`→`number`) without updating every consumer in the same change.
- ❌ Don't return raw DB rows — always go through a response struct in `models.go`.
- ❌ Don't add a new fetch layer alongside `Api` — extend `Api`.

**Patterns to follow:**
- **Library response:** `GET /api/library` → `LibraryResponse{tracks[], albums[], artists[], version, ...}` (`library.go:36-46`). Tracks sorted by title, albums/artists by name. Review status/flags joined in.
- **Collections:** `Playlist{id, name, trackIds[], createdAt}`. Favorites/recent are `[]string` of track IDs. `POST /api/shared-queue` → `{id}`; `GET /api/shared-queue/{id}` → `{trackIds[]}`.
- **Download job:** `GET /api/queue` → `[]DownloadJob`; `POST /api/queue/add` takes a job body with `pipeline:'v2'` + MB IDs.
- **Deep-link params** (`?play=`, `?q=`, `?artist=`, `?album=`, `?playlist=`) are consumed in `app.js:57-107` and the server injects OpenGraph meta for them in `SpaHandler` (`handlers.go:59-146`). Adding a param = update both.

**Gotchas:**
- `trackIds` (not `track_ids`), `albumID` (not `albumId`) — the casing is deliberate and load-bearing.
- `LibraryVersion` bumping is how the frontend knows to refetch — a handler that mutates library data without bumping it leaves the UI stale.
- Shared queues are server-side persisted (not just a frontend concept) — `/api/shared-queue` is the round trip.
- The server injects OpenGraph/Twitter meta for share URLs (`handlers.go:59-146`) — a new deep-link param needs meta support too if it should render rich previews.

**See also:** musicapp-backend (handler implementation, mutex discipline around response data), musicapp-interaction (the flows that consume these shapes).

## Skill 4 — musicapp-backend

**Triggers:** editing `server.go`, `internal/**/*.go` (handlers, store, scanner, downloads, musicbrainz, review, watched, waveform, models); any Go file change, schema change, or background goroutine work.

**Invariants that matter here:**
- **ID generation** — Track ID = `SHA-256(filePath)[:12]`; Album ID = `SHA-256(lower(artist|album))[:12]` (`models/ids.go:11-24`). Never change algorithm/normalization/truncation — orphans user data. Needs a migration plan, not an edit.
- **Path prefix scheme** — secondary-library paths stored with `media:` prefix; primary paths have none. Stored (prefixed) path feeds ID generation (`scanner.go:108-112`, `ResolveFilePath` `scanner.go:28-40`). Preserve exactly.
- **`dbUpsertTrack` preservation** — when existing row has `has_metadata = 1`, scanner must not clobber `title/artist/album/album_artist/album_id/track_number/year/genre` (`database.go:475-493`). This asymmetry is intentional.
- **Schema migration style** — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` only. Additive. No renames, no semantic changes. Existing DB must open cleanly (`database.go:16-119`).
- **Concurrency** — global maps (`Tracks`, `Albums`, `CoverCache`, `CustomCovers`) are `sync.RWMutex`-guarded, accessed by HTTP handlers + background goroutines. Preserve exact locking; never leak map references; lock-ordering changes are high risk.
- **Graceful degradation** — yt-dlp, ffmpeg, python3 are optional. Preserve every fallback path.
- **Vendor mode** — `go build -mod=vendor` required; don't `go mod tidy`/`go get` without also `go mod vendor`.

**Do / Don't:**
- ✅ New handler → register in `server.go:193-314`, place in `internal/handlers/`, follow existing style (log errors via `log.Printf`, return `{"error":"..."}` JSON or HTTP codes). Wrap with `recoveryMiddleware` + `loggingMiddleware` (already global — `server.go:348-371`).
- ✅ Copy structs out under the lock before JSON-encoding (e.g. `library.go:40` `copy := *t`) — never encode a shared map entry while holding only `RLock` then releasing.
- ✅ New column → `ALTER TABLE ADD COLUMN` with the failure-ignored pattern (`database.go:30-119`). Add the struct field + tag. Never rename/drop.
- ✅ New background goroutine → launch in `server.go:151-191` block; wire callbacks there to break circular imports (`scanner ↔ review ↔ handlers` via `scanner.WakeReviewWorker`, `downloads.EnrichFunc`, etc.).
- ✅ Optional-tool dependency → probe via `FindYtDlp`/`FindFfmpeg`/`FindFfprobe` pattern (`downloads.go:156-216`); log warning at startup, don't exit. Expose via `/api/health`.
- ✅ Cover chain degrades: MusicBrainz Cover Art → Deezer artist art → embedded cover → SVG placeholder. Enrichment chain: Python V2 → ffmpeg tagging → bare file. Preserve the full chain.
- ❌ Don't change the ID algorithm, input normalization, or truncation. If a task seems to require it, stop and propose a migration plan.
- ❌ Don't run `go mod tidy` or `go get` without also running `go mod vendor` and committing `vendor/`.
- ❌ Don't add a new Go dependency without approval. If approved: `go get` → `go mod vendor` → commit `vendor/` + `go.sum`.
- ❌ Don't reorder lock acquisition across mutexes without flagging it as high risk. The existing order (e.g. `store.Mu` before `CoverMu`) is load-bearing.
- ❌ Don't leak map references outside lock patterns — return copies, not pointers into shared maps.
- ❌ Don't move `.go` files into new subdirectories (creates new packages) without approval. Adding files within existing `internal/` packages is fine.

**Patterns to follow:**
- **Mutex map:** `store.Mu sync.RWMutex` guards `Tracks`/`Albums` (`store.go:13`); `store.CoverMu` guards `CoverCache` (256MB LRU, `store.go:38`); `ScanMu` serializes scans; `DownloadMu` serializes yt-dlp (one at a time, `downloads.go:237-245`).
- **Lock-free versioning:** `handlers.LibraryVersion atomic.Int64` (`library.go:15`) — bump on any library change; no lock needed.
- **Error handling:** `log.Printf` + `{"error":"..."}` to client; `recoveryMiddleware` catches panics → `{"error":"internal server error"}` + logged `[PANIC]`. `loggingMiddleware` logs every `/api/` request with duration.
- **Schema:** `PRAGMA journal_mode=WAL` + `busy_timeout=5000` (`database.go:27-28`). Pure-Go `modernc.org/sqlite` (no CGo).
- **Startup order:** DB-to-memory load, then optimistic scan-skip (matching file counts → skip rescan) (`server.go:91-149`). Don't reorder.

**Gotchas:**
- There is **no `main.go`** — entrypoint is `server.go` `func main()` (`server.go:23`).
- AGENTS.md says "all `.go` files at repo root, package main" but the code is now refactored into `internal/{downloads,handlers,models,musicbrainz,review,scanner,store,watched,waveform}`. Only `server.go` is at root.
- SPA catch-all (`server.go:319-325`) serves `index.html` for any non-`/api/` path — new routes must be under `/api/` or they'll be shadowed.
- `admin.html` is served at `/admin` and auth-gated by `RequireAdmin` (`server.go:225-228`) — don't touch admin auth unless explicitly asked.
- Vendor mode: `go.sum` and `vendor/` committed; `go build -mod=vendor ./...` must succeed after every change.
- `data/` and `*.db` are gitignored runtime-only (SQLite at `data/music.db`, WAL mode).
- The old `app/` dir is gone; `research/` exists — don't treat either as modifiable app code.

**See also:** musicapp-data (API shapes the handlers emit), musicapp-cross-cut (build/test verification, the full invariant list).

## Skill 5 — musicapp-cross-cut

**Triggers:** changes that touch invariants, accessibility, performance, build/test verification, or span frontend + backend in one change. Not loaded on every change — the other four skills excerpt the invariants they need. Load this one when the work is explicitly cross-cutting (e.g. adding a column that also shifts an API shape and requires an a11y audit).

**Invariants that matter here (the canonical full list — this skill is the source of truth):**
1. **ID generation** — Track = `SHA-256(filePath)[:12]`; Album = `SHA-256(lower(artist|album))[:12]` (`models/ids.go:11-24`). Persisted in favorites, playlists, recents, reviews, download jobs, cover/waveform cache filenames. Changing it orphans user data → needs migration plan, not an edit.
2. **Path prefix scheme** — secondary-library paths stored with `media:` prefix; primary paths have none. Stored path feeds ID generation (`scanner.go:108-112`, `ResolveFilePath` `scanner.go:28-40`).
3. **`dbUpsertTrack` preservation** — `has_metadata = 1` rows resist scanner clobbering of tag fields (`database.go:475-493`).
4. **API JSON shapes** — frontend consumes `/api/*` directly; field names/casing/nesting/types only change when both sides update together + UI verified.
5. **Schema migration style** — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` only. Additive. No renames, no semantic changes (`database.go:16-119`).
6. **Concurrency** — global maps are `sync.RWMutex`-guarded; accessed by handlers + background goroutines. Preserve exact locking; never leak map refs; lock-ordering changes are high risk (`store.go:10-21`).
7. **Startup behavior** — DB-to-memory load order + optimistic scan-skip (matching file counts → skip) stay as-is (`server.go:91-149`).
8. **Graceful degradation** — yt-dlp, ffmpeg, python3 optional. Preserve every fallback (Python enrichment → ffmpeg tagging; cover chain → SVG placeholder).
9. **Build/test verification after every change** — `go build -mod=vendor ./...`, `go vet ./...`, `go test ./...` must pass; never weaken/skip/delete a test; manually exercise frontend paths (no JS build step).
10. **Working style** — scoped diffs, one concern per change, no drive-by edits. New `<script>` tags respect load order (global scope, no ES modules). No new frameworks/build steps/frontend libs. No new Go deps without approval + `go mod vendor`. Don't touch Dockerfile/CI/ports/volumes/env vars/admin auth unless asked.
11. **File layout** — only `server.go` at root (`package main`); rest in `internal/`. Moving `.go` files into new subdirs creates new packages — get approval. Old `app/` gone; `research/` is reference only.
12. **No `main.go`** — entrypoint is `server.go` `func main()` (`server.go:23`).
13. **Vendor mode** — `go.sum` + `vendor/` committed; `go build -mod=vendor` required. Don't `go mod tidy`/`go get` without `go mod vendor`.
14. **Runtime-only / gitignored** — `data/`, `*.db` (SQLite at `data/music.db`, WAL); `music/` test audio (mostly gitignored).

**Accessibility (the cross-cut a11y rules):**
- ✅ `MediaSession` API integration (`player.js:48-69`) powers lock-screen/hardware media keys — keep it working on any player change.
- ✅ Custom sliders (seek/volume) need ARIA slider roles — the waveform canvas seek bar must have an accessible fallback (e.g. a hidden `<input type="range">`).
- ✅ Icon-only buttons need `aria-label` (play/next/queue/etc.) — audit when adding new ones.
- ✅ Keyboard nav: use native `<button>`/`<a>` (free keyboard support); avoid `tabindex > 0` (breaks visual order). Drag-reorder surfaces need a keyboard alternative.
- ✅ Contrast: dark theme grays fail easily. `--text2 #8A8A92` on `--bg #0a0b0a` ≈ 5.2:1 (OK); `--text3 #55555E` on `--bg` ≈ 2.1:1 (**fails WCAG**) — only use `--text3` for truly decorative text. Check new color combos.
- ✅ `prefers-reduced-motion` is honored globally (`base.css:185-194`) — new animations must respect it.
- ❌ Don't ship a new interactive surface without a keyboard path and labeled controls.

**Performance:**
- ✅ Cover art: lazy-loaded server-side (cover cache keyed by album/track ID, 256MB LRU, `store.go:38`); `loading="lazy"` on `<img>`; dominant-color/LQIP placeholder before full art loads.
- ✅ Large lists: the app already uses infinite scroll (`_setupAllMusicScroll` `ui.js:2224`, `_setupReviewScrollLoader` `ui.js:2453`) — match that for new long lists. For very large lists, manual windowing (absolute-position rows in a tall spacer, compute visible range from `scrollTop`).
- ✅ Streaming: Go `http.ServeContent` handles `Range` requests natively → seeking works without re-download. Don't break range support.
- ✅ Waveforms: pre-generated server-side via ffmpeg (`waveform.go`) → ship compact JSON peaks → render to canvas. Don't decode full audio client-side.
- ✅ Polling cadences: queue every 3-5s, library version every few seconds — don't add tight loops.
- ❌ Don't block the UI thread with heavy computation — offload or chunk.

**Build/test verification (run after every change):**
```sh
go build -mod=vendor ./...   # must succeed
go vet ./...                 # no new warnings
go test ./...                # must pass
```
For frontend or handler changes: run the app, load the affected path, exercise it manually (library loads, a track streams, the changed UI works). JS has no type-check/build step — never assume a JS change is safe without loading it. Review the diff: only the intended change, no drive-by edits.

**Gotchas:**
- The 14 invariants above are data contracts. Breaking them corrupts user data or breaks clients even if the code "looks better." When a task seems to require changing one, **stop and confirm** — it needs a migration plan, not a code edit.
- This skill is the canonical home for the invariant list; the other four excerpt subsets. If you update an invariant here, the relevant sibling skill's excerpt may need updating too.

**See also:** all four siblings — this skill is the umbrella they reference.

## Out of scope

- Greenfield new-feature invention (the skills guide/constrain, they don't design new product surfaces from scratch)
- Modifying the installed `superpowers` package itself (skills are local to this repo)
- General-purpose skills (these are musicapp-specific; user-level skills live elsewhere)

## Open questions

None — all design decisions resolved during brainstorming.

## Next step

Invoke the **writing-plans** skill to produce an implementation plan for authoring the five `SKILL.md` files at `.opencode/skills/musicapp-{visual,interaction,data,backend,cross-cut}/SKILL.md`, including verifying each loads via the `skill` tool and committing them to the repo.