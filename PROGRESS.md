# Playback & Navigation Polish — Live Progress

Goal: make music playback and navigation feel as fluid and dependable as Spotify, TIDAL, and YouTube Music. This file tracks the work piece by piece. Newest at the top of each section.

## Current status

**[Wave 1 — reliability + data integrity] Batches pre-step/B/scorer/A/C shipped. Stopping here for device verification.**

Full-system audit (6 parallel sub-agents: store, HTTP/auth, background jobs, business logic, audio+frontend, over-engineering) → grilling session locked scope → 5 committed batches. Root causes fixed, not symptoms.

**Shipped this wave (commits 340058f → 70da050):**
- Diagnostics: weekly playback-failure log (data/playback-failures-*.jsonl, /api/admin/playback-failures) — the instrument for "does it still skip?"
- Playback: prewarm niced; 30s transcode load timeout; ffmpeg encodes hard-timed (a wedge could permanently kill AAC streaming); prune no longer deletes in-flight encodes; pause clears the load timeout (was force-skipping + auto-playing next)
- Downloads: video-version YouTube titles penalized (music-video uploads were beating studio audio)
- Data integrity: boot DB snapshot (data/backups/, 7d); review-worker hot-loop (timestamp-format mismatch → 2s churn all day) fixed; slsk failure cleanup no longer deletes sibling jobs' completed files; failed upserts no longer vanish tracks after restart; playlist rewrite atomic; shared playlists survive restarts; dedup churn between primary/media: libraries ended (primary wins, matching scanner policy)
- Jobs: art fetchers daily (not startup-only); cleanup survives watcher-off; transcode-prune in Workers panel; bare goroutines wrapped

**Verification gate (yours):** test on localhost (or push to GitLab → device). Watch: Safari cold-play, pause-during-load, playlist reorder, restart persistence, Workers panel frequencies, data/backups/ appearing.

**Next (scoped in ROADMAP.md, no code yet):** Batch E security (route wraps, cookies-upload token for the extension, method checks, YouTube-only URL allowlist, guest UI hides) → Batch D UX (view-guards, no force-navigation, badge poll).

---

## Wave log

- **Keystone — playback-first ffmpeg policy:** shipped. Background analysis (bands/waveform/normalize) niced via `downloads.NicedFfmpegCommandContext`; bands re-enabled; critic-reviewed. Awaiting device confirmation.
- **Wave 1 — reliability + data integrity:** shipped 2026-08-19 (pre-step, B, scorer, A, C). Audit-driven, sub-agent-partitioned by file ownership, every diff hand-reviewed before commit. Full suite green (13 packages); live-verified: snapshot on boot, dedup stability with media: fixture, truthful Workers panel, cold transcode 13.5s → cached 28ms.

---

## How we work (honest version)

- Each piece is a builder task → a **separate critic agent with fresh context reads the actual code** (never the builder's summary) and judges it against Spotify/TIDAL/YouTube Music behavior and front-end best practice. If it falls short, the critic names the single biggest gap and sends the builder back. Loop until the critic is satisfied.
- **Limit I will not fake:** I cannot drive the live iOS app from here, and neither can sub-agents — we read code and reason about runtime behavior. The final, binding critic is **your device**. For anything touch/AirPlay/Media-Session-specific, I ship a change and you verify; I won't claim it's perfect until you confirm.
- Between waves, one fresh agent reviews the whole codebase surface for coherence/consistency and smooths the pieces into one experience.
- "Utterly perfect" is asymptotic. I run focused waves, keep this page current, and stop to device-verify at each layer rather than stack unverified changes.

---

## Roadmap (pieces — I decide the breakdown)

### Wave 0 — Dependable foundation (in progress)
- ✅ **Load-time reliability:** disable bands auto-gen (regression source); restore <2s mobile load. *Follow-up:* a shared/niced ffmpeg budget so background analysis (waveform/normalize/bands) can never starve the synchronous playback transcode, and `StreamHandler` non-blocking fallback so playback degrades gracefully instead of timing out.

### Wave 1 — Core playback feel
- Skip/prev immediacy (prewarm N+1/N+2, instant switch, no double-load).
- Seek/scrub feel (drag latency, release accuracy, seek-while-loading).
- Error recovery (network blip / corrupt frame → graceful resume, no silent skip; surface in Needs Review).
- Queue correctness under rapid use (add-next/last, reorder, live refresh, no dupes/lost entries).
- Media Session / lockscreen / background audio continuity (iOS + Android).

### Wave 2 — Transitions & navigation
- Route transitions + back-stack (library → album → artist → now-playing) with scroll restoration.
- Mini-player ↔ now-playing expansion (gesture + animation).
- Now-playing gestures (swipe down dismiss, swipe to queue) on mobile.
- Loading skeletons / perceived performance on library + search.
- Consistent motion language (easing, durations).

### Wave 3 — Richer playback (re-introductions done safely)
- Visualizer reactivity on iOS done RIGHT (bands as niced/idle-throttled job, or scan-time generation; never on the playback-critical path; AirPlay-safe).
- Loudness consistency (the disabled normalize feature reconsidered as server-side, non-playback-breaking).
- Gapless / crossfade (platform-permitting).

### Wave 4 — Hardening & edge cases
- Large-library virtualization (no jank with 10k+ tracks).
- Offline / no-network states.
- Keyboard shortcuts coverage.
- Touch targets + mobile layout audit.

---

## Wave log

- **Wave 0 — bands-disable:** shipped. Awaiting device confirmation that mobile load is fast again.
