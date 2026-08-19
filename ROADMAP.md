# Roadmap

Things being looked at. Not promised. Not scheduled. If it lands, it lands; if
it doesn't, it was never a promise.

## next up (planned, scoped — pick up here)

Hardening batch agreed 2026-08-19; Batches pre-step/B/scorer/A/C are done and
committed (340058f → 70da050). Remaining, in order:

### Batch E — security (internet-exposed instance)
All scoped, decisions locked, no code written yet:
- Route wraps in server.go: `RequireUser` on `/api/artist-art-fetch/`,
  `/api/download/`, `/api/finder/{search,artist/,release/,cover/}`,
  `/api/waveform/`, `/api/bands/`; `RequireAdmin` on `/api/cookies/{clear,extract,status}`
- `/api/cookies/upload`: replace CORS-`*` with a one-time setup token —
  SPA settings generates it (admin), extension popup gets a token field,
  upload handler validates. Extension can't carry session cookies (verified:
  no credentials sent, SameSite=Lax blocks it), so token is the mechanism
- Method checks: POST-only on `/api/delete`, `/api/scan`, `/api/recent/`
  add; `/api/watch/<id>/refresh` → POST (+1-line JS fix in api.js
  refreshWatch — SPA currently sends GET)
- `downloads.AllowedMediaURL` helper: YouTube-only host+path allowlist
  (youtube.com + subdomains, youtu.be; paths /watch /playlist /shorts
  /embed /channel), applied in ResolveURLHandler + ExtractYouTubePlaylistTracks;
  update ripperv2 placeholder to say YouTube
- Login/setup/register: MaxBytesReader 4KB; consider per-IP login backoff
- Guest UI hides in same change as wraps: Finder tab, download buttons
  (mini-player, now-playing, both context menus) hidden for Store.isGuest —
  guests keep library + streaming
- admin.html + file-manager endpoints: KEPT (user decision), just method-checked
Verification: curl matrix (401/403 on previously-open routes), SPA guest view

### Batch D — UX polish
- Late review-page renders: view-guard after awaits (ui-library.js ~460, 504)
  — currently clobbers the current view and pollutes `_viewTrackList`
- Enrich/recheck completion poll: toast-only unless already on needs-review
  (currently force-navigates; ui-library.js ~529, 560)
- Download badge poll: don't clear `_downloadPollInterval` in
  `_clearPollTimers` (ui.js ~1318) or restart it in renderPage

### Parked (decided against for now)
- Soulseek candidate selection could also use DurationMatchScore (the
  post-download >125% rejection already covers both sources; only the
  pre-download pick would improve)
- /api/library server-side caching (only if a >20k-track deployment complains)
- Service worker, JS minification (no build step per AGENTS.md)
- Progressive/streaming transcode output (revisit if cold-start latency still
  bothers after Batch B)
- DB restore tooling (snapshot exists; restore = manual file copy for now)

## looking at
- more visualizer shader looks
- smarter duplicate detection across albums and sources
- playlist import/export (m3u, xspf)
- lyrics sync in the now-playing view
- a cleaner first-run experience

## not doing (yet, maybe)
- cloud sync of libraries
- multi-user accounts
- a native mobile app (the browser + install-as-app is the app for now)