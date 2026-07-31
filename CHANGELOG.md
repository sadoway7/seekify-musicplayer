# Changelog

## Unreleased

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