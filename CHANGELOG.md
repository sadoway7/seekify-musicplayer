# Changelog

## Unreleased

- Visualizer (iOS): Safari/iOS runs the visualizer in decorative mode (album-derived colors + ambient motion, no frequency reactivity) so AirPlay keeps working. iOS Safari does not allow Web Audio output and AirPlay to coexist — routing the primary `<audio>` through `createMediaElementSource` breaks AirPlay (the original normalization regression), and routing a separate silent secondary `<audio>` element through Web Audio breaks it too: the AudioContext claims the iOS audio session and does not release it even after the visualizer is torn down, so AirPlay never recovers (verified on device). An audio-reactive visualizer plus AirPlay on iPhone is not achievable with current browser APIs; decorative is the only mode that preserves AirPlay. Chrome/Firefox/Android keep full audio reactivity via `captureStream` (which taps a copy of the element without rerouting it).
- Fix (casting): restored Chromecast/AirPlay support by removing the shared Web Audio gain graph from the player. Routing the primary `<audio>` element through `createMediaElementSource` (added by the audio-normalization feature) silently disabled remote playback — Chrome drops Cast and Safari drops AirPlay for any media element tapped by Web Audio. The graph was created on first track load regardless of whether normalization was enabled, so casting broke for everyone. The visualizer is restored to its pre-graph design: Chrome/Firefox/Android analyze a silent `captureStream()` copy (primary element stays native → Cast/AirPlay keep working); Safari/iOS has no `captureStream`, so it runs decoratively (no Web Audio reroute) — AirPlay stays intact.
- Audio normalization: client-side replay-gain is temporarily disabled — it required the Web Audio graph that broke casting. The Settings toggle is shown greyed-out with an explanatory note; the backend (per-track `gain_db`, `/api/normalize/<id>`, EBU R128 analysis) remains in place dormant and will return as server-side gain baked into the transcode path, which doesn't conflict with remote playback.
- Fix: JS cache-busters bumped for all files changed this release (api, player, store, visualizer, app) — returning visitors were running old JS against the new backend, which caused slow/broken first loads after deploy.
- Settings: "missing genre" review flag is now off by default for new installs (existing installs keep their saved setting).
- UI: CSS cache-buster bumped so the cursor fix (arrow instead of I-beam on clickable elements) actually loads for returning visitors.
- Visualizer: shaders now compile lazily per-shader on first use instead of all 5 up front — the first frame previously took ~1.3s synchronously (Chrome flagged the safety-net interval at 1304ms), janking the main thread during playback. First frame is also deferred to requestAnimationFrame so a cold compile never runs inside a timer handler.
- Downloads: a Soulseek file that transfers but fails validation (corrupt audio, truncated, low bitrate) now falls back to the next candidate instead of failing the whole job. Previously the multi-candidate list only covered unreachable peers — a corrupt download abandoned the remaining candidates. Up to 3 attempts.
- Downloads: the corrupt-audio threshold is now 1 ffmpeg decode error (was 5). A localized corrupt region can emit as few as 3 error lines while still breaking playback/seeking — such files now get rejected at download time instead of entering the library.
- Playback: seek failures on corrupt files (Chrome reports them as network errors, code 2) are now reported to Needs Review as playback errors, so files that only break when you scrub get flagged instead of silently skipping.
- UI: no more text cursor (I-beam) on clickable elements — the app now defaults to an arrow cursor everywhere, restoring the text cursor only on actual text inputs. Also fixes a broken CSS rule where `-webkit-appearance` was orphaned outside its selector.
- Review: "filename-derived title" flag no longer false-positives on properly-tagged songs whose title happens to match their filename (common for yt-dlp and Soulseek downloads). The flag now only fires on tracks with no embedded tags, where the scanner actually fell back to guessing the title from the filename.
- Reliability: library scans no longer freeze the UI during the database commit. The scan previously held the global library write-lock (`store.Mu`) across the entire DB transaction — every `/api/library`, `/api/stream`, and `/api/cover` request blocked for the duration. The DB commit now runs lock-free; only the in-memory map swap holds the lock briefly.
- Reliability: the periodic duplicate-dedup pass no longer reloads the entire track/album maps from the DB every 5 minutes when no duplicates are found. The reload previously held the write-lock for a full table scan on every cleanup cycle.
- Reliability: no more redundant full rescan on every boot. The file watcher took its baseline snapshot while the startup scan was still running, so the first tick always saw a "changed" tree and triggered a second full scan. The watcher now waits for the startup scan to finish before snapshotting.
- Reliability: the review worker's first run is delayed 90s after boot so cover extraction and cover fetching complete first — previously it could flag tracks as missing covers before the boot-time cover pass ran, and those flags persisted on recheck.
- Mobile/Safari playback: tracks now start instantly on iPhone and iPad. iOS Safari can't stream FLAC/Opus/Ogg (it must download the whole file before playing), which made large FLACs take tens of seconds to load or get skipped. The player now detects which formats the browser can stream and requests a transcoded AAC copy for unsupported ones; the server transcodes on demand (ffmpeg, cached per track, invalidated when the source file changes) and serves it with full seek support. Desktop browsers keep getting the original lossless file untouched. Transcoding can be tuned (bitrate) or disabled in Settings; falls back to the original file if ffmpeg is unavailable. New tracks are primed in the background so the first play is instant too.
- Build: the server now compiles and runs on Windows as well as Linux/macOS. The MusicBrainz cross-process rate-limit file lock (Unix `flock`) and the download process-tree kill (Unix process groups + `kill -pgid`) were Unix-only syscalls that broke the Windows build; they're now build-tag-split per platform (Windows uses `LockFileEx` and `taskkill /T`). No behavior change on Linux/macOS; `scripts/start.bat` now builds successfully.
- Fix (downloads): the download watchdog no longer resets jobs that are still searching. `orphanReset` ran every 2 minutes and re-queued any `searching`/`downloading`/`tagging` job with no registered subprocess — but search-phase jobs (YouTube/Soulseek search) legitimately have no subprocess, so they were reset mid-search and processed a second time. This caused duplicate downloads, the UI flipping a completed job back to "downloading", and download slots being consumed by duplicates — worst for Soulseek, whose search can wait tens of minutes on the login mutex behind in-flight downloads. `orphanReset` now requires a job to be persistently orphaned (active status, no subprocess) for ~45 min before resetting — comfortably past any legitimate search window. Restart-time orphans are still recovered by `RecoverStalledDownloads` at boot.
- Concurrency: playlist-position assignment and the favorite/download toggles now run inside `BEGIN IMMEDIATE` transactions. Concurrent calls could previously interleave at statement granularity (e.g. several downloads finishing into the same playlist at once both read `MAX(position)` and created duplicate positions; rapid toggles lost updates). The legacy single-admin `DbAddRecent` — untransactional and with no callers — is removed; the live per-user recents path (`DbAddUserRecent`) was already transactional.
- Fix (downloads): the retry endpoint now rejects non-`failed` jobs with 409. It previously re-queued any job by id, so retrying an in-flight job would spawn a second processing goroutine (duplicate download). The UI only surfaces Retry on failed jobs, so this was reachable only via a direct API call.
- Library: new "Scan for Corrupt Audio" admin action (Settings → Library/Tasks) decode-checks every file and surfaces corrupt ones in Needs Review under a "Corrupt Audio" flag — finds bad files nobody has played yet, complementing the playback-failure detector. Runs in the background with live progress; non-destructive (flags only).
- Downloads: newly downloaded files are now decode-validated (ffmpeg decodes the whole stream to null) before being accepted into the library, catching mid-stream corruption that passes the existing ffprobe header check. A file with intact headers but broken audio frames previously entered the library and only failed when played; it's now rejected at download time. (End-truncation was already caught by the duration-ratio check.)
- Bad-file detection: tracks that fail to play in-browser (decode error or unsupported codec) are now reported to the server and surface in Needs Review under a new "Playback Failed" flag. Previously the player logged the failure to the browser console and skipped — the most reliable "this file is broken" signal was discarded, so corrupt/truncated downloads stayed hidden. Network errors are ignored (transient); the periodic review worker now preserves this externally-set flag instead of wiping it on recheck.
- Fix: "Retry All" on the downloads/failed tab now retries every failed job in a single request instead of firing one HTTP call per job. The old per-job loop aborted on the first transient error (DB write contention, a 4xx, a network blip), leaving most of a large failed batch un-retried.
- Home (desktop): "New Songs" and "Playlists" sections now use multi-column grids (2 columns at ≥768px, 3 at ≥1440px).
- Home: section titles now have a subtle gradient fade and slightly brighter text.
- Home: shuffle dice has ambient rotation again (slow continuous tumble on all axes).
- Desktop mini-player: progress bar expands on hover (desktop ≥768px only) and is click/drag-seekable — scrub or jump within a track without opening the full now-playing screen. Mobile is unchanged.
- Desktop mini-player: added shuffle, repeat, like, share, download, and more (track context menu) buttons. Active states use the album-derived accent color.
- Desktop mini-player: closing the now-playing overlay no longer force-hides the playlist/queue panel — it stays in whatever state it was in.
- Home (desktop): "Listen Again" grid now uses available width — removed the 1100px max-width cap, added a 7-column layout at ≥1440px, and re-renders on resize so the card count matches the column count (2 rows at every breakpoint).
- UI: context menu options now show a pointer cursor on hover (previously showed a text I-beam).
- Reliability: scanner now checks the DB commit error and skips the in-memory library update on failure — previously a failed commit left the UI showing tracks the DB never persisted, diverging from what a restart would load.
- Reliability: playlist UUID generation uses `google/uuid` instead of swallowing `crypto/rand` read errors (OS entropy failure previously yielded a zero-byte UUID and a PK violation).
- Security: `FinderCoverHandler` now closes upstream response bodies on 404/fallback paths — previously each non-200 MusicBrainz lookup leaked an HTTP connection until process exit.
- Security: `Content-Disposition` filename in download responses strips CR/LF/quotes — track titles can originate from remote YouTube metadata; this prevents response-splitting/header-injection toward anyone who downloads a track.
- Concurrency: the review-enrich active flag is now mutex-guarded — the unlocked read in `ReviewProgressHandler` raced the enrich goroutine's writes (benign data race, visible under `-race`).
- Privacy: `noindex, nofollow` meta tag in `index.html` plus a `/robots.txt` (`Disallow: /`) tell search engines not to index the app or follow its links. Deep links (`?play=`, `?album=`, `?playlist=`, `?artist=`) are unaffected — they're query-string based and handled client-side.
- Audio normalization (**experimental**): tracks are analyzed (EBU R128 via ffmpeg, lazy on first play) and replayed at a configurable target loudness (default −14 LUFS) using a shared Web Audio gain node. Per-track gain is cached in the DB and served via `/api/normalize/<id>`; the player applies it before playback. Enabled by default; toggle in Settings → Playback. The visualizer now taps the player's audio graph (post-gain) instead of building its own, so bars reflect the normalized signal. Marked experimental pending browser-matrix verification of the shared Web Audio graph across Safari/Chrome/Firefox.
- Fix: deleting a track no longer blocks re-downloading it from Finder — the download-queue dedup check now ignores completed jobs (previously any non-failed history row counted).
- Downloads: split the old "Soulseek only" mode into **Soulseek only (no YouTube fallback)** and **Soulseek preferred (falls back to YouTube)**. The old "Soulseek only" silently fell back to YouTube on any Soulseek failure; the new strict mode honors the label, and users who want the previous behavior pick "Soulseek preferred".
- Settings UI: download-source dropdown now reads consistently in fallback order — "Auto — YouTube, then Soulseek", "Auto — Soulseek, then YouTube", "YouTube only", "Soulseek only" (replacing the previous mix of dashes, commas, "preferred", and "(no YouTube fallback)" styles).
- Settings UI (admin): replaced the six-button tab bar with a centered section dropdown (Playback/Downloads/Library/Tasks/Users/About). Non-admin Account/About tabs are unchanged.

## 2026-07-29 — Player skip diagnostics

### Frontend
- Added console logging to `_onMediaError` / load-timeout / play-reject paths to identify which trigger fires when tracks skip (uncommitted investigation; revert once root cause is found)

### Unraid
- Community Apps `<Changes>` now shows a sanitized, dated changelog history (security specifics kept out of the public panel); added AGENTS.md note to always sanitize CA listing text

## 2026-07-28 — Security hardening, bug fixes, visualizer

### Security
- Static-file whitelist for SPA catch-all (was serving `data/music.db` unauthenticated)
- Path-traversal guards on cover/artist-art/finder cover handlers
- Auth required on previously-open endpoints: shared-queue, watch, resolve-url, search, preview, finder-youtube, track-duration
- Body cap on shared-queue writes
- Subprocess timeouts + concurrency caps on yt-dlp/python spawns (preview, v2-search, watched-playlist extract)

### Auth
- Password change now invalidates other sessions (keeps the current device logged in)
- First-run setup race guarded against duplicate admin creation

### Library
- AutoSort rolls back rename on DB failure (no more orphaned favorites); skips overwrite of existing destination
- Ring buffer log snapshot off-by-one fixed

### Frontend
- Visualizer shader cost halved (fixes audio contention when visualizer is on)
- Dice shuffle: Z-axis-only rotation, smooth pose blend on drag/release
- API client handles empty 204 responses

Full audit report: `docs/audits/2026-07-28-seekify-audit.md`.