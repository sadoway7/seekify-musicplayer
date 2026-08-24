# Seekify Audit Checklist — Aug 22, 2026

Full-lifecycle + concurrency audit. Every finding was code-verified unless marked
"needs runtime testing". Work top-to-bottom by rank; check items off as fixed.
Re-verify after each fix: `go build -mod=vendor ./... && go vet ./... && go test ./...`
(+ manually exercise the affected path).

Status legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[-]` won't fix (note why)

---

## Needs your intent call FIRST (blocks F2, F17)

- [ ] **Q1:** Is dedup pass-4 auto-deleting duplicate *files* a feature you want to keep,
  or should it flag/quarantine only? (F2)
- [ ] **Q2:** How exposed are typical deployments meant to be? Should stream/download/
  transcode-warm/shared-queue be user-gated, or is open-LAN the intended mode? (F17)

---

## Critical

- [ ] **F1 — Unauthenticated YouTube cookie endpoints**
  - Where: `server.go:470-474`, `internal/handlers/cookies.go:24-70` (upload, `CorsAny` `*` at :217-228), `:114-193` (extract), `:101-112` (clear), `:195-213` (status oracle)
  - `/api/cookies/extract` runs `yt-dlp --cookies-from-browser` ON THE HOST, unauthenticated → harvests host browser's YouTube session. `/api/cookies/upload` (CORS `*`, no auth) replaces the cookie file → downloads run under attacker's account. `/api/cookies/clear` = unauth DoS. `/api/cookies/status` = unauth existence/size/mtime oracle.
  - Fix: wrap all four in `auth.RequireAdmin`; drop `CorsAny`.
  - Worst on bare-metal; Docker has no browser but upload/replace/clear still exploitable.

- [ ] **F2 — Dedup pass 4 deletes user files from disk on metadata heuristic**
  - Where: `internal/store/database.go:377-494` (delete at :465-483), runs every 5 min (`server.go:299-311`)
  - Same artist+title + equal (or both-zero) duration → loser's row AND file deleted. No content hash. FLAC+MP3 pair, album + Greatest Hits, two unprobed slsk rips all qualify. Irreversible.
  - Fix (pending Q1): quarantine to `duplicates/` or flag-only via review worker; if deletion stays, require content-hash match.

## High

- [ ] **F3 — `/ripperv2` standalone page is broken as shipped**
  - Where: `ripperv2.html:26-38`; `js/ui.js:194, 268, 35`
  - `UI.init()` → `_bindMiniPlayer()` null `addEventListener` (`mini-player` doesn't exist in this page) → TypeError → `RipperV2.render` never runs → blank page. Also `_renderQueue()` is defined in ui-player-chrome.js which isn't loaded.
  - Fix: load ui-player-chrome.js + null-guard `_bindMiniPlayer`, or minimal init for this page.
  - Verify: open `http://host:8081/ripperv2` before + after.

- [ ] **F4 — Slsk selection race: double-processing + data race on shared job**
  - Where: `internal/handlers/downloads.go:449-473`; `internal/downloads/slsk.go:830-891`
  - Handler persists `status='queued'` BEFORE spawning `ProcessSlskSelection` → watchdog/CreateDownloadJob/retry can claim it → re-search + user's pick both run; files land in same destDir; failure cleanups can delete each other's files. Also `writeJSON(w, job)` at :473 races goroutine mutating same `*DownloadJob` (torn JSON, `-race` flag).
  - Fix: persist non-queued status (`downloading`) before spawning; JSON-encode a copy before spawn. (Retry handler already guards this pattern at `handlers/downloads.go:351-358`.)

- [ ] **F5 — Job delete doesn't cancel it; clear-completed kills active searches** (5a clear-completed exclusion FIXED 2026-08-22; 5b delete-cancel FIXED 2026-08-22 via downloads.KillActiveJob)
  - Where: `internal/handlers/downloads.go:414` (delete = row-only), `:515-517` (`NOT IN ('queued','downloading')` includes `searching` + `needs_selection`)
  - Deleted job keeps downloading, track appears "by magic" later. Clear-completed mid-search destroys the row.
  - Fix: kill `ActiveJobs[jobID]` process group under `DownloadMu` on delete; fix exclusion list to keep all four active statuses.

- [ ] **F6 — Watched sync marks limit-rejected tracks completed forever**
  - Where: `internal/watched/watched.go:356-367`; `internal/downloads/downloads.go:726-761`
  - `CreateDownloadJob` returns nil on `ErrDownloadLimit`; watched.go treats nil as "already covered" → row `completed`, never retried, silently missing.
  - Fix: distinguish "already present" from "limit-rejected"; mark rejected rows pending for next sync. (`job_id` column also never populated.)

- [ ] **F7 — Playlist edits are client-side read-modify-write; concurrent edits lost**
  - Where: `js/api.js:190-195`, `js/ui.js:1046-1059`
  - Two tabs/users editing near-simultaneously → last-write-wins on whole `trackIds` array, other edit silently vanishes.
  - Fix: server-side additive/subtractive endpoints or optimistic concurrency (version) on PUT.

## Medium

- [ ] **F8 — Mutagen (enrich.py) rewrites files in place while streamable**
  - Where: `scripts/enrich.py:398,428,440,459,468` vs `internal/handlers/streaming.go:67-108`
  - Concurrent stream reads torn file → decode error → track flagged `playback_error` (`playback.go:184-215`) though file is fine post-tag; flag never auto-clears. `TagAudioFile` already does temp+rename correctly (`downloads.go:2095-2126`).
  - Fix: temp+rename in enrich.py. Needs runtime testing for frequency.

- [ ] **F9 — Queue drag-reorder lost on unshuffle + pre-shuffled-list bypass**
  - Where: `js/player.js:548-556` (`moveInQueue` doesn't mirror `_originalQueue`); `js/ui-context-menus.js:89-91, 138-140, 171-173, 540-546`
  - Reorder with shuffle on → toggling shuffle off restores pre-drag order. Pre-shuffled lists leave `_originalQueue` empty → "unshuffle" can't restore canonical order; shuffle indicator wrong.
  - Fix: mirror the move; context-menu shuffle should set the flag, not pre-shuffle.

- [ ] **F10 — Late async error callbacks blame wrong track**
  - Where: `js/player.js:229-241, 96-126`
  - Late non-Abort `play()` rejection / late `error` event from previous load handled against NEW current track (no generation counter) → healthy track skipped or falsely flagged to `/api/playback-error/:id`.
  - Fix: extend the load-timeout stale-closure guard (player.js:249-252) pattern to error paths. Needs runtime testing.

- [ ] **F11 — Unbounded transcode-warm backlog starves foreground plays**
  - Where: `internal/handlers/transcode.go:62-66`; `internal/transcode/transcode.go:34, 139`
  - `transSem` (cap 2) FIFO-shared between background warm and foreground Safari plays; 500 unauth warm POSTs → minutes-long cold-play delay.
  - Fix: priority acquisition for foreground `Ensure`, cap warm queue depth, require auth on `/api/transcode-warm/` (server.go:328).

- [ ] **F12 — In-memory library diverges from DB after external retag**
  - Where: `internal/scanner/scanner.go:226-231, 432-437` vs `database.go:1047-1081`
  - mtime change → scanner swaps fresh file-tag object into memory wholesale; DB keeps approved columns but `/api/library` serves raw tags + `Duration=0` until restart. Only genre carried over.
  - Fix: carry the preserved DB columns into the fresh object (like `applyScannedGenre`). Needs runtime testing.

- [ ] **F13 — No playback-state persistence; recents on track START**
  - Where: `js/player.js` (no queue/index/position persistence anywhere); `js/app.js:21-25`
  - Reload loses queue + position. Skipped-after-1s tracks dominate Recently Played.
  - Fix: persist `{queue ids, index, position}` on track change + `pagehide`; write recents after N seconds of playback.

- [ ] **F14 — File IO under global library write lock in metadata edit**
  - Where: `internal/handlers/metadata.go:410-482`
  - Cover read/write + full audio tag parse (`extractCoverFromFile`) while holding `store.Mu` write lock → whole-app stall on slow disk/large FLAC.
  - Fix: move cover/extract work outside the lock.

- [ ] **F15 — Library upload writes direct to final path; truncates existing**
  - Where: `internal/handlers/library_upload.go:69, 85-88`
  - `os.Create` → disconnect mid-upload leaves truncated file for scanner; re-upload of same name silently truncates; unconditionally marks `reviewed_ok` clobbering prior review state.
  - Fix: temp+rename, skip-if-exists/overwrite flag, don't force review status.

- [ ] **F16 — Visualizer: no WebGL context-loss handling**
  - Where: `js/visualizer.js:466-467, 870` (zero `webglcontextlost` handlers repo-wide)
  - Lost context never re-acquired, draws no-op, watchdog blind (`_lastRender` still updates) → frozen visualizer until toggled.
  - Fix: `webglcontextlost`/`restored` listeners, reset `this.gl`.

- [ ] **F17 — Ungated mutating surface (beyond cookies)**
  - Where: `server.go:327-331, 366, 384-385, 397-401, 429-430`
  - Ungated: `/api/stream`, `/api/download` (full file download), `/api/transcode-warm` (CPU), `/api/artist-art-fetch/` (external fetches), `/api/waveform`, `/api/bands` (ffmpeg), `/api/shared-queue` create (unbounded rows, no rate limit, no DELETE path anywhere).
  - Fix (pending Q2): at minimum `RequireUser` on warm + shared-queue create.

## Low

- [ ] **F18** — `/api/delete` (`admin.go:180-194`) disk-only: DB/memory/references stale up to 5 min; phantom track + 404s. Route through `ReviewDeleteTrack` (`review.go:565-587`) which does it right.
- [x] FIXED (2026-08-22) **F19** — LIFO download queue (`ORDER BY created_at DESC`, `downloads.go:565`): new jobs starve old; bulk imports download in reverse track order.
- [ ] **F21** — YT terminal-failure paths never call `cleanupFailedDownload` (`downloads.go:1321-1367`): `.part` litter; with `download_format=best` a complete `.m4a` can be imported while job shows failed.
- [ ] **F22** — Dedup txs ignore per-statement errors then commit `DELETE FROM tracks` (`database.go:449-457, 479`) → failed reference-UPDATE silently drops favorites. Pass-3 churn: loser file remains → re-added every 5 min → full map reload under `Mu.Lock` each tick (`database.go:214-227, 318-375`).
- [ ] **F23** — `gain_db` keyed by ID, no mtime invalidation (`normalize.go:64,128`): replaced file keeps old loudness forever (waveform/bands/transcode DO check mtime).
- [ ] **F24** — Recheck-all resets approvals with reviewer `rescrape`/`upload`/`worker`/`enrich`; only `'manual'` survives (`review.go:299-304`).
- [x] FIXED (2026-08-22) **F25** — `deleteAllFlagged` never calls `Player.next()` when current track deleted (`js/review.js:344-359` vs `:316-317`); deleted tracks never pruned from `Player.queue` (`js/review.js:313`).
- [ ] **F26** — Autosort takes no `ScanMu` (`autosort.go:76-110`): prune stat in rename→migrate window deletes row+favorites for a moved file; crash in window cascades; waveform/transcode caches orphan on ID change.
- [ ] **F27** — Settings GET returns `slsk_password` plaintext (`settings.go:18-61`); session cookie lacks `Secure` (`auth.go:146-152`).
- [ ] **F28** — 200-250ms hide-timeouts can re-hide a menu shown right after a hide (`ui-context-menus.js:68-72`, `ui-player-chrome.js:292-300, 373-383`).
- [x] FIXED (2026-08-22) **F29** — Waveform drag held across auto-advance seeks NEW track at old fraction (`js/ui.js:469-484`).
- [ ] **F30** — `IsInSlskShareDir` flags any `shared` path component — legit album named "Shared" never persisted (`store/paths.go:28-31`).
- [x] FIXED (2026-08-22) **F31** — Dead code: `playNextInQueue`, `clearQueue`, `_randomIndex` (`js/player.js:593-613, 639-646`); no UI can clear a queue at all.

### New task (added 2026-08-22, user-reported — NOT yet audited)

- [ ] **F32 — Metadata rescan + album art ranking favors compilations over the well-known original album.** User report: the rescan candidate bar (bottom sheet) and automatic album-art fetch both tend to pick/feature compilations ("Greatest Hits", "Collection", VA comps) above the real studio album people know. Existing machinery that should prevent this but evidently under-performs in practice: `recordingReleasePriority` (`internal/musicbrainz/metadata.go:42` area, ~:527, :617, :830) already penalizes `Compilation` secondary types (unit-tested in `metadata_ranking_test.go`), and title-keyword heuristics exist at `metadata.go:527` and `art.go:396` ("best of", "greatest hits", "compilation", "collection"), plus a `ponytail:` note at `art.go:189` about compilation fallbacks. **Scope when picked up:** (1) audit why the penalty loses in practice — candidate ordering in the picker UI vs auto-pick, artist-credit weighting (VA), release-group type confusion noted at metadata.go:535-537, first-release-date vs popularity signals; (2) cover-art path (`art.go`) ranking separately; (3) write regression tests with real-world cases where a comp currently outranks the studio album. Owner wants compilations ranked strictly below the recognizable original album in BOTH the picker ordering and the auto pick.

---

## Quick map (for restarts)

- **Playing/queue source of truth:** `Player.queue[Player.currentIndex]` (js/player.js); `_originalQueue` = unshuffle snapshot. All views render same refs.
- **Go goroutines:** startup scan, watcher (30s), watched scheduler (1h), download watchdog (2min), review scheduler (24h), art ticker (24h), cleanup ticker (5min), transcode prune (30min), per-job download goroutines (slot cap `download_concurrency`, default 3).
- **Locks:** `store.Mu` (Tracks/Albums), `CoverMu` (cover cache), `DownloadMu` + `createJobMu` (downloads), `slskLoginMu`, `ScanMu` (scans serialize), `WatchMu` (RefreshAll only).
- **Frontend↔backend sync:** polling only — `/api/stats` 5s/30s → `LibraryVersion` → `/api/library` ETag/304. No SSE/WS.
- **Persistence:** DB is authoritative; browser persists only volume/muted/home_layout/viz.

## Not reviewed (known gaps)

- `admin.html` beyond confirm-gates; musicbrainz scoring quality; extension internals;
  real-device iOS/Android behavior; `vendor/`; gitignored scratch (`tests/`, `internal/store/tmpverify/`).

## Highest-value runtime follow-ups

F4 (race window frequency), F8 (torn-read frequency), F12 (UI visibility), F3/F16 repro.
