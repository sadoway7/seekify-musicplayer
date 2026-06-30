# Musicapp Audit Fixes — Perf & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the high-value, low-risk fixes from the 2026-06-29 audit that directly address the two reported symptoms — (1) slow startup on reboot, (2) slow when connecting from remote/mobile devices — plus one explicit UI placement fix.

**Architecture:** All changes are small, surgical edits to existing files. No new packages, no schema migrations, no ID/path changes. Two changes add a pure transport layer (gzip) and re-scope an existing lock; both are behavior-preserving for correct clients. Each task is independently committable and verifiable.

**Tech Stack:** Go (package main + internal/*, modernc.org/sqlite, vendor mode), vanilla JS/CSS SPA (no build step).

**Hard invariants respected (from AGENTS.md):** ID scheme unchanged; `media:` path-prefix preserved; additive schema only (none needed here); mutex discipline preserved (Task 4 narrows a lock, doesn't reorder); startup DB-to-memory load order and scan-skip *logic* preserved (Task 2 only moves *when* the count check runs); yt-dlp/ffmpeg/python3 fallbacks untouched.

**Out of scope (tracked separately):**
- **Orphaned-album cleanup (audit B1, scanner.go:310):** the existing condition is buggy (checks for `:` in a hex-hash ID, which can never match). Correct orphan detection needs its own focused design — do NOT bundle into this plan.
- **Downloads-not-working-after-cookies:** BLOCKED on user runtime evidence (local vs Docker + server-log lines from one failed job).
- **Soulseek:** BLOCKED on user intent (is YouTube chronically failing, or do they want lossless sources?).

---

## File map

- `server.go` — Task 1 (add `gzipMiddleware`, wire it), Task 2 (move scan-skip count check into the scan goroutine).
- `internal/handlers/handlers.go` — Task 3 (make `ScanHandler` async + guard with `atomic.Bool`).
- `internal/handlers/library.go` — Task 4 (release `RLock` before JSON encode; move `DbLoadAllReviewStatuses()` out of the lock).
- `server_test.go` (NEW, package main) — Task 1 test.
- `internal/handlers/library_test.go` (NEW) — Task 4 characterization test.
- `js/ui.js` — Task 5 (move downloads Settings button next to Retry All / Clear History).

---

## Task 1: Add gzip middleware for `/api/` JSON responses

**Why:** `/api/library` returns the full tracks+albums+artists JSON uncompressed. JSON gzips ~5–10×. For remote/mobile clients this is very likely the dominant cause of "slow when connecting from devices." No compression exists today (`server.go:321-322` wraps only logging+recovery).

**Safety:** Scope to `/api/` paths and explicitly skip the binary streams (`/api/stream/`, `/api/cover/`, `/api/artist-art/`) so audio seeking (HTTP Range) and image bytes are never touched. Static/SPA paths are skipped too, avoiding any `Content-Length` mismatch on served files.

**Files:**
- Modify: `server.go` (imports + new `gzipMiddleware` + wiring at 321-322)
- Create: `server_test.go` (package main)

- [ ] **Step 1: Write the failing test**

Create `server_test.go`:

```go
package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGzipMiddleware_CompressesJSON(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"hello":"world"}`)
	})
	srv := httptest.NewServer(gzipMiddleware(inner))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/api/library", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if ce := resp.Header.Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("Content-Encoding = %q, want %q", ce, "gzip")
	}
	if vary := resp.Header.Get("Vary"); !strings.Contains(vary, "Accept-Encoding") {
		t.Fatalf("Vary = %q, want it to contain Accept-Encoding", vary)
	}
	gzr, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(gzr)
	if string(body) != `{"hello":"world"}` {
		t.Fatalf("decompressed body = %q", body)
	}
}

func TestGzipMiddleware_SkipsStreamAndNoAccept(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"ok":true}`)
	})
	srv := httptest.NewServer(gzipMiddleware(inner))
	defer srv.Close()

	// /api/stream/ must never be compressed
	req, _ := http.NewRequest("GET", srv.URL+"/api/stream/abc", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if ce := resp.Header.Get("Content-Encoding"); ce == "gzip" {
		t.Fatalf("stream path was gzip-compressed; must be skipped")
	}
	resp.Body.Close()

	// No Accept-Encoding → pass through
	req2, _ := http.NewRequest("GET", srv.URL+"/api/library", nil)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if ce := resp2.Header.Get("Content-Encoding"); ce == "gzip" {
		t.Fatalf("response gzip-compressed without Accept-Encoding")
	}
	resp2.Body.Close()
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test -mod=vendor -run TestGzip ./...`
Expected: FAIL / build error — `undefined: gzipMiddleware`.

- [ ] **Step 3: Add the middleware to `server.go`**

Add imports `compress/gzip` and `io` to the import block. Then add this middleware next to `recoveryMiddleware` (after `loggingMiddleware`, near `server.go:376`):

```go
type gzipResponseWriter struct {
	http.ResponseWriter
	io.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if g.Header().Get("Content-Type") == "" {
		g.Header().Set("Content-Type", http.DetectContentType(b))
	}
	return g.Writer.Write(b)
}

// gzipMiddleware compresses /api/ JSON responses for clients that accept gzip.
// It deliberately skips binary streams (audio + images) and all non-/api/ paths
// so HTTP Range seeking on audio and Content-Length on static files are unaffected.
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		gzipable := strings.HasPrefix(p, "/api/") &&
			!strings.HasPrefix(p, "/api/stream/") &&
			!strings.HasPrefix(p, "/api/cover/") &&
			!strings.HasPrefix(p, "/api/artist-art/")
		if !gzipable || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		w.Header().Del("Content-Length")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, Writer: gz}, r)
	})
}
```

- [ ] **Step 4: Wire the middleware as the outermost wrapper**

In `server.go`, replace lines 321-322:

```go
	var handler http.Handler = mux
	handler = loggingMiddleware(recoveryMiddleware(handler))
```

with:

```go
	var handler http.Handler = mux
	handler = loggingMiddleware(recoveryMiddleware(handler))
	handler = gzipMiddleware(handler)
```

- [ ] **Step 5: Run tests + build + vet**

Run: `go test -mod=vendor -run TestGzip ./...` → PASS.
Run: `go build -mod=vendor ./...` → succeeds.
Run: `go vet ./...` → no new warnings.

- [ ] **Step 6: Manual verify (transport correctness)**

`./server`, then: `curl -s -H 'Accept-Encoding: gzip' --output - http://localhost:8081/api/library | gunzip | head -c 200` — confirm valid JSON emerges. Then `curl -s -H 'Accept-Encoding: gzip' -D - http://localhost:8081/api/stream/<id> -o /dev/null` — confirm `Content-Encoding` is NOT gzip (stream untouched).

- [ ] **Step 7: Commit**

```bash
git add server.go server_test.go
git commit -m "perf: gzip /api/ JSON responses for remote clients (skip stream/cover/art)"
```

---

## Task 2: Stop blocking startup on the scan-skip file-count walk

**Why:** `server.go:114-149` runs `scanner.CountAudioFiles(dir)` (a full `filepath.Walk` of the whole tree, `watcher.go:25-38`) **synchronously in `main()`**, before `ListenAndServe` (`:348`). On a reboot-after-update where nothing changed, the scan is correctly *skipped* — but the tree is still walked end-to-end first, delaying the server's availability. This is the reported "startup slow on reboot."

**Invariant note (call out to user before merging):** This changes *when* the scan-skip count runs (after listen, inside the goroutine) but NOT the skip logic itself, the DB-to-memory load order, or anything the client observes after boot completes. Flagged as adjacent to the "startup behavior" invariant; user already indicated they want this fixed.

**Files:**
- Modify: `server.go:114-189`

- [ ] **Step 1: Move the count check into the scan goroutine**

In `server.go`, DELETE lines 114-149 (the `needScan := ...` block that runs synchronously). Then modify the goroutine at line 151 so it computes `needScan` itself. The goroutine (151-188) becomes:

```go
	go func() {
		needScan := len(dbTracks) == 0
		if !needScan {
			for prefix, dir := range store.MusicDirs {
				if prefix != "" {
					continue
				}
				count := scanner.CountAudioFiles(dir)
				if count != len(dbTracks) {
					log.Printf("Primary dir file count changed (%d in DB vs %d on disk), rescanning", len(dbTracks), count)
					needScan = true
				}
				break
			}
			if !needScan {
				for prefix, dir := range store.MusicDirs {
					if prefix == "" {
						continue
					}
					count := scanner.CountAudioFiles(dir)
					mediaDBCount := 0
					store.Mu.RLock()
					for _, t := range store.Tracks {
						if strings.HasPrefix(t.FilePath, prefix+":") {
							mediaDBCount++
						}
					}
					store.Mu.RUnlock()
					if count != mediaDBCount {
						log.Printf("Media dir [%s] file count changed (%d in DB vs %d on disk), rescanning", prefix, mediaDBCount, count)
						needScan = true
					}
					break
				}
			}
		}

		if needScan {
			log.Printf("Scanning music directory: %s", store.MusicDir)
			stats := scanner.ScanMusicDir(store.MusicDir)
			log.Printf("Primary scan complete: %d files found, %d tracks loaded", stats.Scanned, len(store.Tracks))

			for prefix, dir := range store.MusicDirs {
				if prefix == "" {
					continue
				}
				log.Printf("Scanning media directory [%s]: %s", prefix, dir)
				mediaStats := scanner.ScanMusicDirWithPrefix(dir, prefix)
				log.Printf("Media scan [%s] complete: %d files found, %d tracks loaded", prefix, mediaStats.Scanned, len(store.Tracks))
			}

			if scanner.LibraryVersionAdd != nil {
				scanner.LibraryVersionAdd(1)
			}
		} else {
			log.Printf("File counts match DB, skipping full scan")
		}

		if pruned := scanner.PruneMissingTracks(); pruned > 0 {
			log.Printf("Pruned %d tracks with missing files", pruned)
		}

		applied := musicbrainz.ApplyApprovedMatches()
		if applied > 0 {
			log.Printf("Applied %d metadata overrides from database", applied)
		}

		scanner.ExtractEmbeddedCovers()
		watched.SyncWatchedPlaylistsToLibrary()
		downloads.RecoverStalledDownloads()
		review.SeedMissingReviewTracks()
		review.CleanupOldReviewFlags()
		review.CleanupOrphanedReviews()
	}()
```

This is a pure move of the unchanged logic from `main()` into the goroutine. `dbTracks` is captured by closure (it is not mutated after line 91).

- [ ] **Step 2: Build + vet + tests**

Run: `go build -mod=vendor ./...` → succeeds.
Run: `go vet ./...` → no new warnings.
Run: `go test ./...` → passes.

- [ ] **Step 3: Manual verify (startup speed + correctness)**

`./server` — note server reaches "Starting server on :8081" markedly faster (the synchronous walk no longer precedes `ListenAndServe`). Confirm `curl -s http://localhost:8081/api/stats` responds immediately after the log line. Then test both branches:
- **Skip branch (nothing changed):** reboot again → log shows "File counts match DB, skipping full scan" and library is served from DB.
- **Rescan branch:** add or remove one audio file under `music/`, reboot → log shows "file count changed ... rescanning", scan completes, frontend poll refreshes.

- [ ] **Step 4: Commit**

```bash
git add server.go
git commit -m "perf: run scan-skip file-count check in the scan goroutine, not at startup"
```

---

## Task 3: Make `ScanHandler` async (stop the admin "Scan" button hanging)

**Why:** `handlers.go:20-44` runs the entire scan inline in the HTTP request. A large library blocks the request for minutes → client/proxy timeout, hung UI, and users clicking Scan again stacks concurrent scans under the mutex.

**Files:**
- Modify: `internal/handlers/handlers.go:20-44`

- [ ] **Step 1: Verify the version-bump situation before editing**

Run: `rg -n "LibraryVersionAdd|LibraryVersion\.Add" internal/ server.go`
Confirm whether `scanner.ScanMusicDir` or `scanner.CheckAndRescan` bump the library version internally. The async path below adds an explicit `LibraryVersion.Add(1)` on completion so the frontend's existing 5s poll (`app.js` `_startLibraryPoll`) refreshes after a manual scan — this is required for correctness once the response no longer waits for the scan. Keep/adjust based on what the grep shows.

- [ ] **Step 2: Add an in-progress guard and move the work to a goroutine**

In `internal/handlers/handlers.go`, replace `ScanHandler` (lines 20-44) with:

```go
var scanInProgress atomic.Bool

func ScanHandler(w http.ResponseWriter, r *http.Request) {
	if !scanInProgress.CompareAndSwap(false, true) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"scanning": true})
		return
	}
	go func() {
		defer scanInProgress.Store(false)
		stats := scanner.ScanMusicDir(store.MusicDir)

		for prefix, dir := range store.MusicDirs {
			if prefix == "" {
				continue
			}
			mediaStats := scanner.ScanMusicDirWithPrefix(dir, prefix)
			stats.Scanned += mediaStats.Scanned
			stats.Added += mediaStats.Added
			stats.Removed += mediaStats.Removed
		}

		musicbrainz.ApplyApprovedMatches()
		scanner.AutoSortMusic()
		scanner.ExtractEmbeddedCovers()
		log.Printf("Scan complete: %d scanned, %d added, %d removed", stats.Scanned, stats.Added, stats.Removed)

		go musicbrainz.FetchMissingCovers()
		go musicbrainz.FetchMissingArtistArt()

		LibraryVersion.Add(1) // bump so the frontend poll refreshes after an async scan
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"started": true})
}
```

`atomic` is already imported in package `handlers` (used in `library.go:11,15`). No new import needed.

- [ ] **Step 3: Build + vet + tests**

Run: `go build -mod=vendor ./...`, `go vet ./...`, `go test ./...` → all pass.

- [ ] **Step 4: Manual verify**

`./server`, then trigger a scan from the admin UI: the response returns immediately (UI shows "started"), the page does not hang, and ~5s after the scan finishes the home view refreshes via the version poll. Trigger a second scan while one is running → returns the "scanning" status (no stacked scan).

- [ ] **Step 5: Commit**

```bash
git add internal/handlers/handlers.go
git commit -m "perf: run ScanHandler asynchronously with an in-progress guard"
```

---

## Task 4: `LibraryHandler` — release the RLock before JSON-encoding

**Why:** `library.go:33-34` holds `store.Mu.RLock()` (via `defer RUnlock()`) across `review.DbLoadAllReviewStatuses()` (a DB query), list building, **and** `json.NewEncoder(w).Encode(resp)` (`:137`). The lock is only an RLock, so it blocks *writers* (scans, metadata/favorites edits) for the entire time the client drains a possibly-large payload — exactly the "one slow remote client stalls writes" pattern. The fix narrows the lock to just the map-copy phase.

**Files:**
- Modify: `internal/handlers/library.go:32-138`
- Create: `internal/handlers/library_test.go`

- [ ] **Step 1: Write a characterization test (locks in current behavior before refactor)**

Create `internal/handlers/library_test.go`:

```go
package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func TestLibraryHandler_ReturnsTracksAlbumsArtists(t *testing.T) {
	// Seed the in-memory store under its lock.
	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{
		"t1": {ID: "t1", Title: "Song A", Artist: "Artist X", AlbumID: "a1", FilePath: "music/x/01.mp3"},
		"t2": {ID: "t2", Title: "Song B", Artist: "Artist Y", AlbumID: "a2", FilePath: "music/y/02.mp3"},
	}
	store.Albums = map[string]*models.Album{
		"a1": {ID: "a1", Name: "Album One", Artist: "Artist X"},
		"a2": {ID: "a2", Name: "Album Two", Artist: "Artist Y"},
	}
	store.Mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/library", nil)
	rec := httptest.NewRecorder()
	LibraryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp models.LibraryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Tracks) != 2 {
		t.Errorf("tracks = %d, want 2", len(resp.Tracks))
	}
	if len(resp.Albums) != 2 {
		t.Errorf("albums = %d, want 2", len(resp.Albums))
	}
	if len(resp.Artists) != 2 {
		t.Errorf("artists = %d, want 2", len(resp.Artists))
	}
}
```

- [ ] **Step 2: Run it to confirm it passes against current code**

Run: `go test -mod=vendor ./internal/handlers/ -run TestLibraryHandler` → PASS. (This proves the test exercises the real handler before we refactor.)

- [ ] **Step 3: Refactor — move the DB query out of the lock and release the lock before encode**

In `internal/handlers/library.go`, replace the body of `LibraryHandler` (lines 32-138). The change: (a) call `review.DbLoadAllReviewStatuses()` **before** locking; (b) build `trackList`, `albumList`, and `artistList` under the RLock; (c) **explicitly `RUnlock()`** after the lists are built; (d) sort, paginate, and encode **outside** the lock. Replace the `defer store.Mu.RUnlock()` line and restructure as:

```go
func LibraryHandler(w http.ResponseWriter, r *http.Request) {
	// Review statuses live in their own DB table; no map lock needed to read them.
	reviewStatuses := review.DbLoadAllReviewStatuses()

	// Snapshot the maps under the read lock; do all sorting/encoding after release
	// so a slow client draining the response cannot block writers.
	store.Mu.RLock()
	trackList := make([]models.Track, 0, len(store.Tracks))
	for _, t := range store.Tracks {
		copy := *t
		if rs, ok := reviewStatuses[t.ID]; ok {
			copy.ReviewStatus = rs.Status
			copy.ReviewFlags = rs.Flags
		}
		trackList = append(trackList, copy)
	}

	albumList := make([]models.Album, 0, len(store.Albums))
	for _, a := range store.Albums {
		albumList = append(albumList, *a)
	}

	artistMap := make(map[string]*models.Artist)
	for _, t := range store.Tracks {
		name := t.Artist
		if _, exists := artistMap[name]; !exists {
			artistMap[name] = &models.Artist{Name: name}
		}
		artistMap[name].TrackCount++
	}
	for _, a := range store.Albums {
		name := a.Artist
		if _, exists := artistMap[name]; exists {
			artistMap[name].AlbumCount++
		}
	}
	store.Mu.RUnlock()

	sort.Slice(trackList, func(i, j int) bool { return trackList[i].Title < trackList[j].Title })
	sort.Slice(albumList, func(i, j int) bool { return albumList[i].Name < albumList[j].Name })

	artistList := make([]models.Artist, 0, len(artistMap))
	for _, a := range artistMap {
		artistList = append(artistList, *a)
	}
	sort.Slice(artistList, func(i, j int) bool { return artistList[i].Name < artistList[j].Name })

	offset, hasOffset := 0, false
	limit, hasLimit := 0, false
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
		hasOffset = true
	}
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
		hasLimit = true
	}

	resp := models.LibraryResponse{
		Tracks:  trackList,
		Albums:  albumList,
		Artists: artistList,
		Version: LibraryVersion.Load(),
	}

	if hasOffset || hasLimit {
		if !hasLimit {
			limit = 100
		}
		resp.TotalTracks = len(trackList)
		resp.TotalAlbums = len(albumList)
		resp.TotalArtists = len(artistList)
		if offset < len(trackList) {
			end := offset + limit
			if end > len(trackList) {
				end = len(trackList)
			}
			resp.Tracks = trackList[offset:end]
		} else {
			resp.Tracks = []models.Track{}
		}
		if offset < len(albumList) {
			end := offset + limit
			if end > len(albumList) {
				end = len(albumList)
			}
			resp.Albums = albumList[offset:end]
		} else {
			resp.Albums = []models.Album{}
		}
		if offset < len(artistList) {
			end := offset + limit
			if end > len(artistList) {
				end = len(artistList)
			}
			resp.Artists = artistList[offset:end]
		} else {
			resp.Artists = []models.Artist{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
```

Notes preserved from the original: tracks/albums are copied by value into local slices (so no map reference escapes the lock — required by the mutex invariant). The sorting order is identical (Title for tracks, Name for albums/artists). Pagination logic is byte-for-byte identical.

- [ ] **Step 4: Run the characterization test + full suite + build + vet**

Run: `go test -mod=vendor ./internal/handlers/ -run TestLibraryHandler` → PASS.
Run: `go build -mod=vendor ./...` → succeeds.
Run: `go vet ./...` → no new warnings.
Run: `go test ./...` → passes.

- [ ] **Step 5: Manual verify**

`./server`, load the home view — tracks/albums/artists render correctly, counts are right. Open an album and a track row — metadata and review overlays still show. (Confirms the snapshot+overlay logic survived the refactor.)

- [ ] **Step 6: Commit**

```bash
git add internal/handlers/library.go internal/handlers/library_test.go
git commit -m "perf: release LibraryHandler RLock before JSON encode; move review DB query out of lock"
```

---

## Task 5: Move the downloads "Settings" button next to Retry All / Clear History

**Why:** User report: on the finder/downloads tab the Settings button is in the tab-bar row (`ui.js:2553`), while Retry All + Clear History are in a separate `.queue-stats-actions` row below (`:2797-2800`). Settings should sit on the same row as those actions.

**Edge case to handle:** the `.queue-stats` block (`:2788`) currently only renders when there's activity (`activeCount>0 || completed>0 || failed>0 || needsSel>0`). Naively moving Settings there would hide it on an empty queue. The fix renders the actions row (with Settings) **always**, and the badges row only when there's activity.

**Files:**
- Modify: `js/ui.js:2547-2553` (remove from tab bar) and `:2788-2802` (always render actions row with Settings)

- [ ] **Step 1: Locate the existing `#btn-dl-settings` click binding**

Run: `rg -n "btn-dl-settings" js/ui.js`
Read each hit. The binding (click → open settings panel) must keep working after the button moves — confirm whether it's bound via delegation (works from anywhere inside `#downloads-content`) or via direct `querySelector` after render. Note the line(s); the move below keeps the same `id`, so delegated binding is unaffected and direct-query binding still finds it in the new location.

- [ ] **Step 2: Remove the Settings button from the tab-bar row**

In `js/ui.js`, replace line 2553:

```js
      + (this._finderTab === 'downloads' ? '<button class="lib-tab" id="btn-dl-settings" style="margin-left:auto;white-space:nowrap">' + Icons.settings() + '<span style="margin-left:6px">Settings</span></button>' : '');
```

with:

```js
      ;
```

(This terminates the `let html =` statement; the `.lib-sticky-header` div is closed later by the per-tab branches at `:2556`/`2559`.)

- [ ] **Step 3: Always render a stats bar with the Settings button + actions**

In `js/ui.js`, replace the block at lines 2788-2802:

```js
      if (activeCount > 0 || counts.completed > 0 || counts.failed > 0 || needsSel > 0) {
        html += '<div class="queue-stats">'
          + '<div class="queue-stats-badges">'
          + (counts.queued > 0 ? '<span class="stat-badge stat-queued">' + counts.queued + ' queued</span>' : '')
          + (activeCount > 0 && counts.queued <= 0 ? '<span class="stat-badge stat-active">' + activeCount + ' active</span>' : '')
          + (needsSel > 0 ? '<span class="stat-badge stat-failed">' + needsSel + ' needs pick</span>' : '')
          + (counts.completed > 0 ? '<span class="stat-badge stat-completed">' + counts.completed + ' done</span>' : '')
          + (counts.failed > 0 ? '<span class="stat-badge stat-failed">' + counts.failed + ' failed</span>' : '')
          + '</div>'
          + '<div class="queue-stats-actions">'
          + (failedCount > 0 ? '<button class="settings-btn settings-btn-primary" id="btn-retry-all-failed" style="font-size:11px;padding:4px 10px;white-space:nowrap">&#x21bb; Retry All</button>' : '')
          + (counts.completed > 0 || counts.failed > 0 ? '<button class="settings-btn" id="btn-clear-history" style="font-size:11px;padding:4px 10px;white-space:nowrap">Clear History</button>' : '')
          + '</div>'
          + '</div>';
      }
```

with:

```js
      {
        const showBadges = activeCount > 0 || counts.completed > 0 || counts.failed > 0 || needsSel > 0;
        html += '<div class="queue-stats">';
        if (showBadges) {
          html += '<div class="queue-stats-badges">'
            + (counts.queued > 0 ? '<span class="stat-badge stat-queued">' + counts.queued + ' queued</span>' : '')
            + (activeCount > 0 && counts.queued <= 0 ? '<span class="stat-badge stat-active">' + activeCount + ' active</span>' : '')
            + (needsSel > 0 ? '<span class="stat-badge stat-failed">' + needsSel + ' needs pick</span>' : '')
            + (counts.completed > 0 ? '<span class="stat-badge stat-completed">' + counts.completed + ' done</span>' : '')
            + (counts.failed > 0 ? '<span class="stat-badge stat-failed">' + counts.failed + ' failed</span>' : '')
            + '</div>';
        }
        html += '<div class="queue-stats-actions">'
          + '<button class="settings-btn" id="btn-dl-settings" style="font-size:11px;padding:4px 10px;white-space:nowrap">' + Icons.settings() + '<span style="margin-left:6px">Settings</span></button>'
          + (failedCount > 0 ? '<button class="settings-btn settings-btn-primary" id="btn-retry-all-failed" style="font-size:11px;padding:4px 10px;white-space:nowrap">&#x21bb; Retry All</button>' : '')
          + (counts.completed > 0 || counts.failed > 0 ? '<button class="settings-btn" id="btn-clear-history" style="font-size:11px;padding:4px 10px;white-space:nowrap">Clear History</button>' : '')
          + '</div>'
          + '</div>';
      }
```

The Settings button now (a) always renders, (b) sits on the same row as Retry All / Clear History, (c) keeps its `id` so the existing binding still attaches.

- [ ] **Step 4: Manual verify (no build step for JS)**

`./server`, open the app → go to the finder/downloads tab.
- With an empty queue: Settings button shows alone in the actions row.
- With failed/completed jobs: Retry All / Clear History appear on the same row, to the right of Settings.
- Click Settings → the settings panel opens (binding still works).

- [ ] **Step 5: Commit**

```bash
git add js/ui.js
git commit -m "ui: move downloads Settings button to the Retry All / Clear History row"
```

---

## Final verification (after all tasks)

- [ ] `go build -mod=vendor ./...` succeeds
- [ ] `go vet ./...` introduces no new warnings
- [ ] `go test ./...` passes
- [ ] Manual: app boots fast; remote client loads library quickly (gzip); admin Scan doesn't hang; downloads tab Settings button sits next to Retry All/Clear History and still opens settings.

## Self-review notes
- Spec coverage: startup slowness → Task 2; remote-device slowness → Tasks 1 & 4; scan-hangs-UI → Task 3; Settings-button placement → Task 5. All four reported items covered.
- Out-of-scope items (B1 orphaned albums, downloads-not-working, Soulseek) are explicitly deferred with their blockers stated, not silently dropped.
- Type/name consistency: `gzipMiddleware`, `scanInProgress` (`atomic.Bool`), `LibraryVersion.Add` (existing, same package) used consistently. No new identifiers referenced before definition.
- Each task ends in a green build+vet+test and a commit; no task depends on another, so order can be changed and any task can be reverted independently.
