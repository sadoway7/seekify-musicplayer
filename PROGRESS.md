# Playback & Navigation Polish — Live Progress

Goal: make music playback and navigation feel as fluid and dependable as Spotify, TIDAL, and YouTube Music. This file tracks the work piece by piece. Newest at the top of each section.

## Current status

**[Wave 0 — playback reliability] Fixing the regression before any polish.**
Mobile songs were slow / not loading. Root cause (confirmed by code+flow analysis, not guessing): the precomputed-band feature (`/api/bands/`) ran a full-track ffmpeg decode + in-process FFT on every iOS track change, competing with the synchronous playback transcode for CPU and blowing the 10s load timeout → skip → cascade. **Fix shipped:** bands auto-generation disabled; handler still serves cached data. This returns the app to the pre-bands fast-load baseline. **Awaiting your device verification that mobile songs load fast again.**

Once playback is confirmed dependable, Wave 1 begins.

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
