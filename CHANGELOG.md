# Changelog

## Unreleased

- UI: toast notifications redesigned — larger light pill, dead-centered on screen with a springy pop that matches the app's motion style.

- Fix (guests): tapping the favorite button while signed out now shows a clear "Log in to save favorites" toast instead of a generic failure.

- Fix (home): the signed-out sample strip now fills exactly one row on every screen size instead of spilling a stray card onto a second row on wide displays.

- Fix (web): app updates can no longer serve stale JS/CSS — asset versions are now stamped by the server on every deploy instead of hand-edited, removing the "forgot to bump" failure mode entirely.

- Internal (architecture): the in-memory library now sits behind a single locking module, routes are declared in one table with their auth levels, and the remaining cross-package hooks are wired in one visible place — no behavior change, just a smaller, safer surface for future work. (Full write-up: ARCHITECTURE-REVIEW-AUG-23.md, executed cards 1/2/4/5.)

- Removal (ripper): the old standalone Ripper page (`/ripperv2`) has been removed — the Finder tab is the one rip/download UI. Everything it did (search, queue, quality picks) lives in the Finder; downloads, watched playlists, and enrichment are untouched.

- Performance (covers): album covers no longer re-download across the whole home page every time the library changes (a finished download, a scan, an edit) — only covers that actually changed refresh now, so background activity no longer causes visible cover flicker and reload bursts, especially on remote/phone connections.

- Performance (home): during an active download session or scan, the home page now refreshes once per settled batch instead of re-fetching and re-rendering the whole library after every single track lands.

- Fix (playback): losing internet mid-playlist no longer burns through the whole queue — network failures now pause playback and automatically resume the current track when the connection returns.

- Fix (playback): a track that stalls mid-song (buffer runs dry and never refills) now recovers itself — one automatic retry, then a clear "tap play" pause, instead of hanging the progress bar forever.

- Fix (playback): auto-skipping broken files stops after three consecutive failures instead of grinding through the entire queue with a skip-storm.

- Fix (playback): a late error from a skipped track can no longer be blamed on the next track — no more wrong files flagged for review or wrongly reported durations.

- Fix (guests): guest playback no longer pops the login screen when it reports a track duration or a playback hiccup in the background.

- Fix (playback): deep links (`?play=…`) now start through the same guarded load path as everything else, so the first tap of play can't hang silently on a bad connection.

- Fix (playback): Shuffle All uses a proper unbiased shuffle and resets shuffle state through the player instead of bypassing it.

- Fix (server): audio streams now send cache validators (ETag/Last-Modified) so clients re-validate cheaply and detect changed files after a retag instead of splicing stale bytes; the server also sheds hung connections via header/idle timeouts.

- Fix (downloads): deleting a job that is actively downloading now stops the download process instead of letting it finish in the background — the track no longer appears in the library after you deleted its job.

- Fix (downloads): picking a Soulseek quality candidate can no longer trigger a second, automatic search for the same job in the moment between your pick and the download starting — selections download exactly what you chose, once.

- Fix (watched playlists): when the download limit is reached during a watched-playlist sync, new tracks are retried on the next sync instead of being permanently marked completed and silently never downloaded.

- Fix (downloads): the download queue now takes the oldest waiting job first instead of the newest — queued tracks download in the order they were added and new submissions no longer starve older ones.

- Fix (downloads): "Clear Completed" no longer deletes jobs that are still searching or waiting for a quality pick — only finished/failed jobs are cleared.

- Fix (Needs Review): bulk-deleting all flagged tracks now skips playback forward if the currently-playing track was among the deleted, instead of continuing to play a deleted file.

- Fix (player): finishing a waveform seek drag after the track auto-changed no longer jumps the new track to the old drag position.

- Fix (playback): Dolby-audio .m4a files — Apple Music "Spatial Audio" and other Dolby Digital/Dolby Digital Plus rips — failed to play in Chrome and other browsers with a format error, exactly like the earlier Apple Lossless case. The server now detects all of these codecs and transparently serves a browser-playable copy.

- Fix (playback): on slow connections a track that was still downloading could be wrongly skipped as broken, and the skip cascade could make every following track fail too — even manual retries. Slow-loading tracks now retry once via a much smaller stream, and picking any track manually always starts fresh.

- Performance (covers): album covers now paint instantly from the browser cache on repeat views and quietly refresh in the background, instead of every render waiting on a revalidation round trip per cover — the home and library pages open visibly faster, especially on remote/phone connections.

- UI (home): the Shuffle All die got a new flat look — solid dark body with lime pips and a single soft shadow band, replacing the cream toon-shaded style (tuned in a live style demo).

- UI (Ripper): search results and the artist tracklist now show content-shaped skeleton rows while loading instead of a lone spinner — the layout no longer jumps when results arrive.

- UI (home): signed-out visitors now see a playable sample strip (shuffle card plus random tracks with cover art) below the welcome banner instead of an empty page.

- UI (navbar): the Ripper tab's download-count badge keeps its own colors when the tab is active — the active-label color no longer bleeds into the count.

- UI (navbar): the Home / Ripper / Library tab icons were replaced with a new custom "scan glitch" icon set — the active tab's icon gets a short glitch/scanline select animation and a settled glitched resting look.

- UI (mobile): the browser address-bar/app tint now matches the app's dark background exactly on all screens (a slightly lighter shade was used in two places).

- UI (PWA): installed-app identity is now pinned in the app manifest, so home-screen launches reliably open the installed app instead of occasionally spawning a duplicate browser tab.

- UI (Needs Review): per-category filter counts no longer include entries for tracks that are no longer in the library — the chips and their badge counts can't disagree after files are removed.

- Fix (stability): a transient database hiccup during startup or while deleting a playlist could crash the affected operation with an internal error instead of recovering cleanly. Both paths now tolerate the failure and continue.

- Performance (app open): the app now opens noticeably faster. Startup requests run in parallel instead of sequentially, and app assets (JS/CSS) are cached between releases instead of re-downloading on every open — only a deploy changes them. The ripper page's assets are now versioned per release too, so they can never go stale. Opening the app with an unchanged library now skips the full library re-download entirely (a tiny revalidation check replaces a multi-megabyte transfer), and review changes (approvals, flags) refresh the library for open tabs immediately.

- UI (PWA): the installed app opens with the app's dark background instead of a white flash.

- Fix (logs): the Server Log and Track Log in Settings → Logs showed empty or near-empty output once the server had been running for a while — the in-memory log buffer discarded its entire contents instead of the oldest lines when full. Logs now keep the most recent content as intended.

- Fix (playback): Apple Lossless (ALAC) .m4a tracks failed to play in Chrome and some other browsers (format error) because the browser claimed support for the container while unable to decode the codec. The server now detects ALAC files and transparently serves a browser-playable AAC copy.

- UI (Needs Review): "Rescan Meta, Art & Genres" now processes only the tracks flagged for review shown on that page — previously it scanned the whole library for any track missing a canonical genre, making the run far longer than the page implied.

- Fix (downloads): a rare database hiccup during heavy library scans could crash an in-flight download job with an internal error instead of retrying; download job bookkeeping now tolerates transient database failures.

- UI (Needs Review): filter chips for review categories with zero matching tracks are now hidden — only categories that actually have flagged tracks appear.

- Internal (dependencies): updated the embedded SQLite engine (modernc.org/sqlite v1.51.0 → v1.57.0) and crypto libraries (golang.org/x/crypto v0.53.0 → v0.55.0). Brings upstream SQLite correctness and performance fixes; no API, schema, or behavior changes.

- UI: dragging across the app no longer highlights UI text (cards, rows, buttons behave like a native app). Text fields, download details, and log viewers remain selectable for copying.

- UI (stability): navigating away from the Needs Review page mid-load no longer overwrites the destination view, and review rows loaded late can no longer leak into another view's play queue. Background rescans/rechecks that finish while you're elsewhere now show a completion notice instead of yanking you back to the review page. The downloads badge keeps updating on every screen while downloads run (it previously froze after leaving the finder tab).

- Settings (admin): new Logs tab — view, copy, or download the server log, track log, weekly playback-failure log, and review log without shell access to the container.

- Fix (Soulseek, auto-fallback): in "Auto — Soulseek, then YouTube" mode, a failed Soulseek attempt pinned the job to Soulseek, so retries (and most queued tracks) failed permanently instead of falling back to YouTube. Only jobs with a user-picked Soulseek candidate stay on the Soulseek path now.

- Fix (Soulseek, matching): searches for tracks credited to multiple artists ("A, B & C") never matched — remote files usually credit only the primary artist. Matching now requires the primary artist and ignores extra credited collaborators.

- Fix (user downloads): the Save File / download button served library files with a mismatched length header, which browsers read as a truncated transfer — downloads failed on first attempt and only limped through after pressing resume. File downloads are now served uncompressed with an exact length, matching audio streaming.

- Fix (background): YouTube playlist watching no longer runs automatically. The playlist importer UI is not exposed, but previously saved watched playlists kept triggering hourly YouTube searches and downloads with no way to see or stop them. The feature can be re-enabled with the `watched_enabled` setting; the watch API itself is unchanged.

- Downloads (wrong-version protection): album/artist imports now know each track's real length (from MusicBrainz) and use it two ways — YouTube candidates whose duration closely matches the studio recording are strongly preferred (a "Live Version" upload of the same song runs 15-50% longer and previously won selection on title/channel bonuses alone), and a downloaded file substantially longer than the expected track is rejected automatically. When no length is known (single-track downloads, searches), behavior is unchanged. Verified against a real case: a live-version "I Am the Man" that previously shipped as the studio track now selects the correct studio recording.

- Reliability (background jobs): album cover and artist art fetching now runs on a daily schedule in addition to startup — previously a network hiccup at boot left placeholders until the next restart or manual trigger. The library cleanup pass (prune + duplicate removal) now keeps its own 5-minute schedule even when the file watcher is disabled, and the transcode-cache purge is visible in the Workers panel. The Workers panel now shows every background job with its true frequency.

- Reliability (database): the server now keeps a rolling 7-day safety backup of the library database (created at startup before anything touches it), so a failed upgrade or corruption never means total library loss. Restores are a file copy back.

- Fix (review worker): resolved a background scheduling bug where the metadata-review worker could re-check the same tracks every 2 seconds all day (CPU/database churn, noisy logs) due to a timestamp-format mismatch. Rechecks now occur on their intended schedule.

- Fix (Soulseek): a failed download in a bulk album rip no longer deletes files that earlier tracks in the same rip already downloaded and added to the library. Failure cleanup is now scoped to the files the failed transfer itself created.

- Fix (library): tracks no longer silently vanish after a restart when a database write fails mid-scan — failed writes are logged, and memory now always matches what was actually persisted.

- Fix (playlists): reordering a playlist can no longer wipe its contents if an error occurs mid-save — the rewrite is now a single atomic transaction.

- Fix (playlists): shared playlists (e.g. from watched-playlist sync) stay visible to all users across server restarts — a startup migration could re-assign them to the admin only.

- Fix (duplicates): duplicate detection between the primary and secondary library no longer flips repeatedly (delete/re-add churn every 5 minutes with a brief library lock each cycle). The primary-library copy now consistently wins, matching scanner policy.

- Downloads (YouTube): auto-selection now prefers the real music version over video uploads. Titles marked "Official Video", "Music Video", "MV", "Video Oficial" etc. are penalized (unless you searched for a video), closing the gap where a music-video upload could beat the studio audio — especially when YouTube Music search is unavailable and only regular YouTube results are in the candidate pool.

- Reliability (playback): a wedged ffmpeg transcode can no longer permanently break AAC streaming for Safari-family clients. Every encode now runs with a hard time limit, so a stalled process (pathological input, stalled disk) releases its slot and the next play attempt starts fresh instead of every subsequent request blocking forever. Cache pruning also no longer deletes the in-progress encode's temporary file mid-write, which could fail an otherwise healthy transcode.

- Fix (player): pausing during a slow track load no longer force-skips to the next song. Previously the load timeout kept running after you hit pause; when it fired it reported a false playback failure, skipped the track, and auto-played the next one. The timer is now cleared on pause (and stale timer callbacks are ignored).

- Fix (waveform): the waveform display now regenerates when a track's file changes on disk (re-download, re-tag). Previously the old waveform was served forever.

- Settings: "no cover art" review flag is now off by default for new installs (existing installs keep their saved setting). Library scans are less noisy out of the box; an admin can re-enable it in Settings → Library and it works exactly as before.

- Fix (rescrape): metadata rescrape now updates the album art in the UI immediately. Previously the server fetched the new art correctly, but the browser kept showing the stale image (same URL, no cache-bust) until a full page reload. The cover URL is now busted on every metadata update, and the update bumps the library version so other open tabs/devices refresh too.

- UI: the no-artwork placeholder is now a plain colored gradient (per album/artist) with no glyph or icon.

- Fix (review): the "Recheck" progress counter showed "Rechecking undefined/N" — the poll read a field the server never sends. Now shows the real count.

- Performance (PWA boot): the full library JSON is no longer downloaded twice on every app start (the home view re-fetched what boot had just fetched; it now reuses data fetched in the last 15s, and the stats poll still refreshes on library changes). Album covers are now served with ETag revalidation — unchanged covers return tiny 304 responses instead of being fully re-downloaded on every visit (~30-50 images per load), while new art still appears immediately.

- Fix (rescan): a background "Rescan Meta, Art & Genres" run now bumps the library version when it finishes, so its metadata/genre/cover results reach every open tab automatically — previously you had to stay on (or return to) the Needs Attention page to see results, and unattended sessions never picked them up.

- Diagnostics (playback): every player-side playback failure (load timeout, decode error, rejected play) is now logged server-side to a weekly rotating file `data/playback-failures-<year>-W<week>.jsonl` (one JSON object per line; prior weeks deleted on write). Each entry records the reporting client (user, user-agent), the failure itself (reason, HTMLMedia error code/message, network/ready state, whether the load was a transcode request) and track stats (format, duration, file size, transcode-cache state) — enough to answer "which client, which file, why" for any skip. Viewable at `GET /api/admin/playback-failures` (admin). The existing review-flagging behavior (codes 3/4 only) is unchanged; timeouts/network blips are logged but never flag a track.

- Fix (mobile/Safari playback, "sometimes songs don't play"): two root causes addressed. (1) The next-track transcode prewarm ran at normal CPU priority — when the user hit play while the prewarm encode was running, the two encodes raced for CPU and the foreground (play) encode could blow past the client's 10s load timeout, which then skipped the track. Prewarm now runs at background priority (`nice -n 19`, same playback-first policy as waveform/bands/normalize; `transcode.EnsureLow`). (2) That fixed 10s timeout was too tight for legitimate cold-cache transcodes of long files (a whole-file AAC encode can take 10-30s on first play); the client now arms a 30s load timeout for transcoded loads, 10s for native streams. Skipped: progressive/streaming transcode output (would eliminate the wait entirely but is a transcode-pipeline rewrite) — add if cold-start first-play latency still bothers after these fixes.

- Playback reliability (keystone): introduced a playback-first ffmpeg CPU policy so the reactive visualizer and fast mobile playback coexist. All background audio analysis (waveform, frequency bands, and EBU R128 normalize) now shells out to ffmpeg at the lowest OS scheduling priority (`nice -n 19`, via a shared `downloads.NicedFfmpegCommandContext` helper), so it always yields CPU to the foreground playback transcode — which runs synchronously in the stream handler (`StreamHandler` blocks until the AAC encode finishes) and must stay fast. Re-enabled the previously-disabled band-timeline generation (reactive visualizer on iOS, without breaking AirPlay); bands also remains cap-1 and only fetched when the visualizer is on. Root cause of the earlier ricocheting regressions (bands broke playback → disabling bands killed the visualizer) was the lack of any priority layer across the shared server CPU; this is that layer. See PROGRESS.md.

- Fix (mobile playback): the precomputed band timeline is now only generated when the visualizer is actually turned on. The initial implementation fetched `/api/bands/<id>` on every track change on iOS, triggering a heavy full-track ffmpeg decode per track in the background — which competed with the transcode endpoint for CPU and stalled mobile playback (songs not playing / slow to load). Bands now lazy-load from the render loop only while the visualizer is on, and bands generation concurrency is capped at 1 (was 2) so it never competes with playback/transcode. Users who don't use the visualizer incur zero server load.

- Visualizer (iOS, full solution): audio-reactive on iPhone again, with AirPlay intact — without any client-side Web Audio. iOS Safari has no `captureStream`, and every `createMediaElementSource` routing variant tested kills AirPlay (primary→speaker, secondary→speaker, secondary→MediaStreamDestination — all confirmed on device). The new approach sidesteps Web Audio entirely: the server precomputes a per-track frequency-band timeline (bass/mid-low/mid-high/treble over time) via ffmpeg + a Go FFT, cached as JSON (with source-mtime invalidation, unlike the waveform cache), served at `/api/bands/<id>` (lazy compute + poll, mirroring `/api/waveform/`). The client visualizer fetches the timeline on track change and drives the shaders from it synced to `Player.audio.currentTime`. No `AudioContext` is created on Safari → AirPlay stays on the primary element's native path. Until a track's timeline loads (first play), the visualizer renders ambient, then pulses. Chrome/Firefox/Android keep live `captureStream` analysis (unchanged, zero extra cost). The AirPlay smart-disable is retained (hides the visualizer to album art with a toast during casting).

- Visualizer (iOS): reverted to decorative mode (album colors + ambient motion, no pulse) — the only state where AirPlay reliably works on iPhone. Three Web Audio variants were tested on device and all broke AirPlay the moment a media element entered a running AudioContext: MES-on-primary → analyser → speaker (9051caf — the pre-regression "working" state, which actually had AirPlay dead), MES-on-secondary → gain(0) → speaker (b8b88c6, 077c6ff), and MES-on-secondary → analyser → MediaStreamDestinationNode (e22a5d3). The culprit is the `AudioContext` + `createMediaElementSource` itself, not where the graph outputs — so no Web Audio routing preserves AirPlay on iOS. The only theoretical path to reactive-viz + AirPlay is JS-side decoding with no AudioContext (WebCodecs/WASM), a separate major project. The AirPlay smart-disable is retained: when AirPlay engages, the visualizer hides to album art with a toast ("Visualizer is unavailable during AirPlay") and restores on disconnect. Chrome/Firefox/Android keep full reactivity via `captureStream` (unchanged).
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