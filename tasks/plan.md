# Playback Resilience — implementation plan

Fixes from the playback audit (see audit report, session of Aug 2026). Locked decisions:
network errors pause (not skip) + resume on `online`; stall = auto-retry once then pause;
history stays written on track-start; full scope including server LOWs.

No schema, ID, or API-shape changes. All eight tasks independently verifiable.

## Phase 1 — Player resilience (js/player.js core)

1. **Network-failure pause + online resume + cascade cap** — M. Classify network-flavored
   failures in `_onMediaError` (offline, non-seek-corrupt code 2, load-timeout after
   transcode retry) → pause + toast, no queue advance. `window 'online'` listener (guarded
   for test harness) re-`_loadAndPlay(current)`. Cap skip cascade at
   `Math.min(queue.length, 3)`. Tests in player.test.mjs.
2. **Mid-playback stall watchdog** — M. `waiting` arms 30s timer cleared by
   `playing`/`timeupdate`/`pause`, reset per load. On fire: offline → path 1; else retry
   current track once; second stall → pause + toast. Never advances queue. Tests.
3. **Error-generation guard** — S. `_loadAndPlay` records `_activeSrc`; `error` and
   `loadedmetadata` ignore events whose `a.src` doesn't match. Fixes late-error
   misattribution and wrong-track duration reports. Known limit: repeat-one identical
   URLs indistinguishable. Tests.
4. **Guest 401 — silent calls stay silent** — XS. api.js `_req`: move `fallback` return
   above the `auth-required` dispatch. Throwing calls still surface expiry; `/api/stats`
   poll is ungated so login flow unaffected. Manual guest-mode verify.

## Phase 2 — Playback entry points

5. **Deep-link `?play=` through guarded path** — S. app.js:102-113: stop setting
   `audio.src` directly; set queue/index + fire callbacks + toast. `togglePlay`: no-src
   branch → `_loadAndPlay(currentTrack)`. Tests + manual deep-link drill.
6. **Shuffle-all bypass fix** — XS. ui-context-menus.js:540-542: Fisher-Yates (copy at
   555) instead of biased sort; `if (Player.shuffle) Player.toggleShuffle()` instead of
   direct write.

## Phase 3 — Server robustness

7. **Stream caching validators** — M. `serveRangeable`: `ETag: "s-<size>-<mtimeNano>"` +
   `Last-Modified` from stat; `If-None-Match` → 304; `If-Range` mismatch → full 200.
   Multi-range stays 416. Table-driven test in streaming_test.go (serveRangeable is
   package-private).
8. **HTTP server timeouts** — XS. server.go:526: `http.Server{ReadHeaderTimeout: 10s,
   IdleTimeout: 120s}`. NO WriteTimeout (10-min sync transcode path).

## Checkpoints

- C1 after T1-2: JS tests pass; kill-server drill + network-throttle drill.
- C2 after T3-4: rapid-skip drill; guest-mode manual pass.
- C3 after T5-6: deep-link + shuffle-all drills; Safari/Chrome pass.
- C4 after T7-8: `go build -mod=vendor ./... && go vet ./... && go test ./...`; all JS
  tests; CHANGELOG complete.

## Housekeeping

One CHANGELOG.md line per task under Unreleased. Unraid `<Changes>` (templates/seekify.xml)
stays sanitized if touched at all. Commits only when requested.
