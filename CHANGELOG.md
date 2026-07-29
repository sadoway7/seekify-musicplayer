# Changelog

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