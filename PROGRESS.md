# Playback & Navigation Polish — Live Progress

Goal: make music playback and navigation feel as fluid and dependable as Spotify, TIDAL, and YouTube Music. This file tracks the work piece by piece. Newest at the top of each section.

## Current status

**[Wave 0 — playback reliability + system coupling] Fixing the root cause, not the symptom.**

The ricocheting regressions (bands broke playback → disabling bands broke the visualizer → …) all share one root cause: **the server has no playback-first policy across its shared CPU.** The sync playback transcode (`StreamHandler` blocks on ffmpeg), background analysis (bands/waveform/normalize), and the boot path all grab CPU independently with no priority/coordination, so any change to one ricochets into the others.

**The couplings:**
- Playback (iOS) ← sync transcode ↔ background analysis (bands/waveform) — shared CPU, no coordinator.
- Visualizer (iOS) ← bands data ← that same CPU — so bands-on = stall, bands-off = dead viz. A false either/or.
- Web Audio viz ↔ AirPlay — orthogonal iOS limit, already routed around via precomputed bands.
- Boot ← sync dedup + background goroutines ↔ first `/api/library` — slow startup.

**Plan, in dependency order (each device-verified before the next):**
1. **KEYSTONE — playback-first ffmpeg policy.** Background analysis (bands + waveform + normalize) runs **niced (lowest priority)** under a shared low cap; playback transcode stays foreground. → re-enable bands → reactive visualizer AND fast playback coexist (the either/or disappears).
2. **Startup** — dedup off the sync boot path; post-listen quiet period; cache `/api/library` by `LibraryVersion`; parallelize the client's ~6 sequential boot fetches; `defer` the 18 render-blocking scripts.
3. Polish waves (see roadmap).

**Interim → now shipped:** the keystone (playback-first ffmpeg policy) is live. All background analysis (bands + waveform + normalize) runs niced (lowest CPU priority); the playback transcode stays foreground. bands re-enabled → reactive visualizer. Verified by a harsh critic agent reading the actual diff (MEDIUM-HIGH confidence; one gap it found — normalize wasn't niced — fixed).

**Verification gate (yours):** confirm on device — visualizer pulses AND songs load fast. If yes → step 2 (startup). If somehow still contended → fallbacks already designed (tighter shared background cap, bands-gated-on-transcode-ready).

---

## Wave log

- **Keystone — playback-first ffmpeg policy:** shipped. Background analysis (bands/waveform/normalize) niced via `downloads.NicedFfmpegCommandContext`; bands re-enabled; critic-reviewed. Awaiting device confirmation.

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
