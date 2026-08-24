# Todo — playback resilience

Generated from plan.md. Update status as tasks complete.

- [x] T1 Network-failure pause + online resume + cascade cap (player.js, player.test.mjs)
- [x] T2 Mid-playback stall watchdog (player.js, player.test.mjs)
- [x] CHECKPOINT 1: JS tests + kill-server/throttle drills (tests pass; manual drills pending — see notes)
- [x] T3 Error-generation guard (player.js, player.test.mjs)
- [x] T4 Guest 401 fallback reorder (api.js)
- [x] CHECKPOINT 2: rapid-skip drill + guest-mode pass (tests pass; manual drills pending — see notes)
- [x] T5 Deep-link ?play= guarded path (app.js, player.js, player.test.mjs)
- [x] T6 Shuffle-all Fisher-Yates + toggleShuffle (ui-context-menus.js)
- [x] CHECKPOINT 3: deep-link + shuffle drills, Safari/Chrome pass (pending manual — see notes)
- [x] T7 Stream ETag/Last-Modified/If-Range (streaming.go, streaming_test.go)
- [x] T8 HTTP server timeouts (server.go)
- [x] CHECKPOINT 4: go build/vet/test, all JS tests, CHANGELOG complete

## Manual drills still owed (need a running server + browser)

1. Kill the server mid-queue → expect pause + "Network unavailable" toast (not a skip cascade); restart server / reconnect → auto-resume or tap-play reloads the current track.
2. Throttle network mid-song until the buffer stalls → expect one auto-retry, then "Stream stalled — tap play" pause.
3. Guest mode: play a duration-less track (fresh download) → no login screen.
4. `/?play=<id>` → tap play → loads with watchdog; Safari range-seek after a retag still works (If-Range path).
