# Musicapp — Full App Audit

**Date:** 2026-06-29
**Scope:** Backend performance, correctness/concurrency, frontend UX, perceived slowness.
**Method:** Direct source read across `internal/handlers/*`, `internal/store/*`, `internal/scanner/*`, `js/*`, `server.go`. Every finding cites `file:line`.

Findings are prioritized by **Impact × Likelihood**, not by difficulty. Each item lists: what's wrong, the evidence, the user-facing symptom, and a fix direction that respects the hard invariants (ID scheme, path-prefix scheme, additive schema, mutex discipline, graceful degradation).

---

## P0 — High impact, fix soon

### A1. Covers are never cached by the browser (biggest perceived-slowness source)
- **Evidence (backend):** `internal/handlers/streaming.go:118,127,142,164,177,194,204` — every cover/artist-art/placeholder handler sets `Cache-Control: no-cache`.
- **Evidence (frontend):** `js/api.js:18-21` — `coverUrl()` appends `?v=libVersion` cache-buster, *intending* long cache + version-keyed invalidation. Dead because the server forbids caching.
- **Symptom:** Every library/album/artist view re-downloads every cover image on every navigation. With dozens of `<img>` rows this dominates page-load time and bandwidth, especially on the production container serving FLAC covers.
- **Why safe to fix:** Album/artist IDs are immutable SHA-256 hashes (hard invariant). Covers for a given ID only change when the album is rescanned, which bumps the library version that the frontend already threads through `?v=`. So `Cache-Control: public, max-age=31536000, immutable` is correct; the existing `?v=` bust handles invalidation.
- **Fix:** Replace `no-cache` with a long immutable cache directive on the cover/art/placeholder handlers. Verify the frontend `?v=` query actually changes when a cover changes (rescan path already bumps libVersion — confirm end to end). This single change is the highest ROI item in the audit.

### A2. `ScanHandler` runs the entire scan synchronously in the HTTP request
- **Evidence:** `internal/handlers/handlers.go:20-44` — `ScanMusicDir`, media-dir scans, `ApplyApprovedMatches`, `AutoSortMusic`, and `ExtractEmbeddedCovers` all execute inline before the response is written. Contrast startup (`server.go:151`) which runs the same work in a goroutine.
- **Symptom:** A large-library scan takes minutes; the HTTP request hangs, the browser/proxy times out, and the admin UI shows no progress. User likely clicks "Scan" again → concurrent scans under the same mutex → contention/stalls.
- **Fix:** Kick off the scan in a goroutine, return immediately with a status, and rely on the *already-existing* library-version polling (`App._startLibraryPoll`, `js/app.js:112`) to refresh the UI. Add an in-progress flag so a second request returns "already scanning" instead of stacking scans.

### A3. `LibraryHandler` holds the global write lock across a DB query + full JSON encode
- **Evidence:** `internal/handlers/library.go:32-37` — `defer store.Mu.RUnlock()` wraps `review.DbLoadAllReviewStatuses()` (DB query), list building/sorting, **and** `json.NewEncoder(w).Encode(resp)`.
- **Symptom:** For the entire duration of serializing a large library payload to the client, *all* writers (scans, metadata edits, favorites) are blocked. On a slow client the lock is held until the last byte flushes. This is the classic "one slow response freezes the app" lock-anti-pattern flagged by the invariants (treat lock-ordering/hold-time as high risk).
- **Fix:** Snapshot the needed data into local slices under the RLock, release the lock, then encode. `DbLoadAllReviewStatuses` should run outside the lock (it reads its own DB rows). Verify no map reference escapes the lock.

---

## P1 — Medium-high impact

### B1. Scanner never cleans up primary-dir Album entries on rescan
- **Evidence:** `internal/scanner/scanner.go:310-314` — the album-cleanup loop body contains only a comment. Tracks ARE removed at `:305-309`; albums are not. Media-prefix albums are never cleaned either.
- **Symptom:** Renaming/moving/deleting an album on the primary library leaves orphaned `Album` map + DB rows. Accumulates over time; inflates album counts in `StatsHandler` and the library artist/album lists; wastes memory.
- **Fix:** Mirror the track-cleanup logic: collect `newAlbums` during the scan, then delete primary-dir albums in `store.Albums` (and DB rows) not in that set. Preserve the ID scheme — do NOT re-derive IDs differently.

### B2. Non-virtualized full re-renders on album / artist / playlist / home / genre views
- **Evidence:** `js/ui.js:5775-5808` `renderTrackList` builds one HTML string with an `<img>` per row. Paging *exists* for the "All Music" list (`_setupAllMusicScroll` ui.js:2224-2254 and :2457, pageSize 50), but these call sites pass the **full** array:
  - `renderAlbum` (:2281), `renderArtist` (:2327, :2370), `renderPlaylist` (:2404)
  - `_renderHomeContent` new songs (:1441) and favorites (:1487)
  - genre results (:1629, :1644)
- **Symptom:** A large album/playlist/artist page renders hundreds of rows and fires hundreds of cover-image loads at once → main-thread jank + image storm (compounded by A1, since every image is a fresh fetch).
- **Fix:** Extract the existing IntersectionObserver virtualization into a reusable helper and apply it to the unbounded call sites. Pair with A1 so the now-cached covers cost nothing to re-reference.

### B3. Minor edits trigger a full library refetch + full page re-render
- **Evidence:** `js/review.js:215,259` (and similar) call `await Store.refreshLibrary()` (full `GET /api/library`) then `UI.renderPage()` after editing one track's metadata.
- **Symptom:** Editing one track's tags refetches the whole library and rebuilds the current page. Slow and visually jarring on large libs.
- **Fix:** Mutate the single `Store._trackMap` entry with the edited fields and re-render only the affected row/region. Keep `refreshLibrary` for bulk changes (scan-complete).

### B4. Player treats slow-buffering audio as a broken file
- **Evidence:** `js/player.js:112` — `_loadTimeout = setTimeout(() => this._onMediaError(), 10000)`. `_onMediaError` → "File unavailable — skipping".
- **Symptom:** Large FLAC files, slow disk, or weak network that takes >10 s to start playing are auto-skipped as if corrupt. The user sees tracks "refuse to play" when they're just buffering.
- **Fix:** Use the timeout only to surface a "Loading…" indicator; reserve actual skip behavior for the media element's real `error` event.

---

## P2 — Low-medium impact (polish / robustness)

### C1. `getWaveform` polling gives up silently after ~4.5 s
- **Evidence:** `js/api.js:348-359` — 3 retries × 1.5 s; on still-`pending` returns the pending object with no further polling and no UI signal.
- **Symptom:** Waveform area stays blank forever for slow-to-generate tracks, with no indication of failure or in-progress state.
- **Fix:** Longer/adaptive retry or a visible "generating waveform…" state until success/failure.

### C2. `DbAddRecent` is non-transactional and renumbers all rows per play
- **Evidence:** `internal/store/database.go:216-221` — four separate `DB.Exec` (DELETE, `UPDATE recent SET position=position+1`, INSERT, trim), no transaction.
- **Symptom:** Low. Capped at 50 rows, so the cost is tiny. The real risk is partial-failure leaving recents in an inconsistent order.
- **Fix:** Wrap in a single transaction.

### C3. Watcher double-walks the whole tree each poll
- **Evidence:** `internal/scanner/watcher.go:89-105` — `CountAudioFiles` walks everything; on change it sleeps 5 s and walks again.
- **Symptom:** Non-trivial disk IO on large libs every poll interval. Acceptable today; worth a cheaper change-detection (mtime/counts cache) later.

### C4. ExtractEmbeddedCovers doesn't warm the in-memory cover cache
- **Evidence:** `internal/scanner/scanner.go:489-519` — writes cover to disk and sets `Albums[albumID].HasCover=true` but never calls `store.CacheCover`. First `CoverHandler` request misses cache and re-reads disk. (Compare `ScanSingleFile:627`, which does cache.)
- **Fix:** Call `store.CacheCover(albumID, pic.Data)` after the disk write.

### C5. Library poll thrashes the home view during scans
- **Evidence:** `js/app.js:124-128` — `_startLibraryPoll` polls `/api/stats` every 5 s; on version change while on home it does `refreshLibrary()` + `renderPage()`.
- **Symptom:** During an active scan the home view can re-render repeatedly. Mild visual churn.
- **Fix:** Debounce/coalesce, or only re-render on final stability. (Interacts with A2 — once scanning is async, the poll is the correct signal, just tame its render cadence.)

### C6. `Store` hands out mutable references; player/review mutate track objects directly
- **Evidence:** `js/store.js:121-148` returns live refs; `player.js:32` writes `track.duration`; `review.js:135` writes `track.reviewStatus`.
- **Symptom:** Low today. A stale ref after `refreshLibrary` (which replaces `this.library` and rebuilds maps) silently points at orphaned data.
- **Fix (long-term):** Return copies, or centralize mutation behind Store methods. Not urgent.

### C7. StreamHandler reimplements HTTP Range handling
- **Evidence:** `internal/handlers/streaming.go:52-95` — manual `bytes=` parse + `io.CopyN`; no Last-Modified, no ETag, no multipart.
- **Symptom:** Works for normal seeking; fragile for edge cases. Low priority.

### C8. No HTTP server timeouts
- **Evidence:** `server.go:348` `http.ListenAndServe` with no timeouts.
- **Symptom:** Slowloris-style slow-client exposure. Nuance: a `WriteTimeout` would break long audio streams, so set carefully (use `ReadHeaderTimeout` + per-handler write deadlines, not a blanket `WriteTimeout`).

### C9. CoverCache LRU removal is O(n)
- **Evidence:** `internal/store/covers.go:107-111` — `RemoveCover` linear-scans the order slice.
- **Symptom:** Negligible at 256 MB cap. Swap to a container/list doubly-linked list if you ever care.

### C10. `removeTrackFromPlaylist` fetches all playlists to update one
- **Evidence:** `js/api.js:134-139`.
- **Symptom:** Wasteful, tiny scale.

---

## Confirmed non-issues (checked, intentionally not fixed)
- **XSS escaping:** `_esc` (`ui.js:7092`) uses textContent→innerHTML + attribute escaping. Unescaped `data-track-id`/`src` values are SHA-256 hash IDs (safe by the invariant). OK.
- **Event-listener leaks:** single delegated `click` listener using `e.target.closest(...)` on the content container; `innerHTML` re-renders don't orphan listeners. OK.
- **Now-playing color extraction:** `_applyNowPlayingBg` (`ui.js:7168-7217`) samples a 10×10 canvas, cached per album (`_lastColorAlbumId`), runs only on track change — not per `timeupdate`. `updateMiniPlayer`'s timeupdate path only sets CSS vars. Same-origin covers ⇒ no canvas taint. OK.
- **Media Session API:** wired (`player.js:48-69`). OK.
- **Cover cache memory bound:** 256 MB LRU (`store.go:38`). OK.

---

## Recommended sequencing
1. **A1** (cover caching) — smallest change, largest perceived-speed win, unblocks B2.
2. **A2** (async scan) — unblocks the admin "scan hangs" problem; makes the poll loop (C5) meaningful.
3. **A3** (lock scope) — removes the freeze-under-load risk; pure mechanical refactor.
4. **B1** (album cleanup) — correctness; do alongside the next scanner change.
5. **B2 + B3** (virtualize + targeted updates) — frontend jank; do together after A1.
6. **B4** (player buffering UX) — standalone, user-facing.
7. P2 items opportunistically.

Each P0/P1 item is independently shippable and respects the hard invariants. None require schema migrations or ID-scheme changes.
