# Changelog

## Unreleased

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