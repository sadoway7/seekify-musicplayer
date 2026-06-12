# App Review & Cleanup Plan

## Phase 1: Critical Bug Fixes

### 1A. Review Worker Infinite Loop (Go)

**Root cause**: `runReviewBatch` returns `true` when `len(batch)>0` even if all IDs were orphaned. Orphaned `track_reviews` rows never get cleaned up because `scanner.go` deletes tracks but not their review rows.

**Changes:**

1. **`review.go:759`** — Fix return value:
   ```go
   return len(toCheck) > 0
   ```

2. **`review.go:78-97` (`dbGetTracksByReviewStatus`)** — Add in-memory filter (same pattern as `dbGetReviewCounts:68-72`):
   ```go
   func dbGetTracksByReviewStatus(status string, limit int) []string {
       // ... existing query ...
       for rows.Next() {
           var id string
           rows.Scan(&id)
           mu.RLock()
           _, exists := tracks[id]
           mu.RUnlock()
           if !exists { continue }
           ids = append(ids, id)
       }
       return ids
   }
   ```

3. **`review.go`** — Add `cleanupOrphanedReviews` function:
   ```go
   func cleanupOrphanedReviews() {
       result, _ := db.Exec(`DELETE FROM track_reviews WHERE track_id NOT IN (SELECT id FROM tracks)`)
       if affected, _ := result.RowsAffected(); affected > 0 {
           log.Printf("[review] Cleaned up %d orphaned review rows", affected)
       }
   }
   ```

4. **`server.go:161`** — Call it at startup (replace or add after `cleanupOldReviewFlags`):
   ```go
   cleanupOrphanedReviews()
   ```

5. **`scanner.go:264-266` and `270-272`** — Add `dbDeleteReview` calls alongside `dbDeleteTrack`:
   ```go
   dbDeleteTrack(oldID)
   dbDeleteReview(oldID)
   ```

### 1B. Nine UI Bug Fixes (JS)

| # | File:Line | Fix |
|---|-----------|-----|
| 1 | `js/ui.js:5713` | Remove `e.target.closest(...)` line; use `Store.viewData.playlistId \|\| ''` directly |
| 2 | `js/ui.js:1691` | Change `a.HasCover` to `a.hasCover` |
| 3 | `js/ui.js:2044` | Add `html += '</div>';` after the forEach, before closing `}` of the if-block |
| 4 | `js/ui.js:5281` | Change to `const track = Store.getTrack(row.dataset.trackId); dur.textContent = this._formatTime(track ? track.duration : 0);` |
| 5 | `js/app.js:88-98` | Delete the duplicate `if (playId)` block; change line 99 `else if (artistName)` to `if (artistName)` |
| 6 | `js/ui.js:2444` | Change `[data-tab="downloads"]` to `[data-tab="finder"]` |
| 7 | `js/ui.js:366-409` | Remove `_bindTopProgress()` function and its call; remove `\|\| this.topSeeking` from line 4789 |
| 8 | `js/ui.js:~471` | Add `let prevVolume = 0.5;` before the mini-volume click handler |
| 9 | `js/ui.js:2655-2673` | Add `this._previewAudio` cleanup at top of `_doPreview`: pause/stop previous audio before creating new |

---

## Phase 2: Worker Efficiency (Go)

### 2A. Concurrency Guards for Cover/Art Fetch

**Problem**: `fetchMissingCovers` and `fetchMissingArtistArt` run as detached goroutines with no guard. Startup run + manual scan run can overlap.

**Changes:**

1. **`musicbrainz.go`** — Add mutexes:
   ```go
   var coverFetchMu sync.Mutex
   var coverFetching bool

   func fetchMissingCovers() {
       coverFetchMu.Lock()
       if coverFetching { coverFetchMu.Unlock(); return }
       coverFetching = true
       coverFetchMu.Unlock()
       defer func() { coverFetchMu.Lock(); coverFetching = false; coverFetchMu.Unlock() }()
       // ... existing body ...
   }
   ```
   Same pattern for `fetchMissingArtistArt` with `artFetchMu`/`artFetching`.

2. **`musicbrainz.go`** — Gate with new settings (see Phase 4):
   ```go
   func fetchMissingCovers() {
       if !getSettingBool("cover_fetch_enabled", true) { return }
       // ... concurrency guard + body ...
   }
   ```

### 2B. Scan Mutex (prevent concurrent full rescans)

**Problem**: `scanMusicDir` has no mutex. Watcher, download completion, manual scan, and auto-sort can all trigger overlapping full scans.

**Changes:**

1. **`scanner.go`** — Add scan mutex:
   ```go
   var scanMu sync.Mutex

   func scanMusicDir(dir string) {
       scanMusicDirWithPrefix(dir, "")
   }

   func scanMusicDirWithPrefix(dir, prefix string) {
       scanMu.Lock()
       defer scanMu.Unlock()
       // ... existing body ...
   }
   ```

### 2C. Scan-After-Download Fix (incremental)

**Problem**: `downloads.go:618-620` calls `scanMusicDir(musicDir)` — a FULL library rescan — after every single download.

**Changes:**

1. **`scanner.go`** — Add `scanSingleFile` function:
   ```go
   func scanSingleFile(filePath string) {
       scanMu.Lock()
       defer scanMu.Unlock()
       // Read tags from filePath
       // Create Track struct
       // Insert into tracks map + dbUpsertTrack
       // dbInsertUncheckedReviews for the new track
       // Trigger reviewWake
   }
   ```

2. **`downloads.go:618-620`** — Replace `scanMusicDir(musicDir)` with `scanSingleFile(audioFile)`.

### 2D. Watcher Debounce + Mutex

**Problem**: `startWatcher` does a full `filepath.Walk` every 30s to count files. Triggers full rescan on count change. No debounce, no mutex.

**Changes:**

1. **`watcher.go`** — Add configurable interval from settings:
   ```go
   interval := getSettingInt("watcher_interval", 30)
   if interval < 5 { interval = 5 }
   ```

2. **`watcher.go`** — Add enable check:
   ```go
   if !getSettingBool("watcher_enabled", true) {
       time.Sleep(5 * time.Minute)
       continue
   }
   ```

3. **`watcher.go`** — Add debounce: after detecting a count change, wait 5s and re-check before triggering rescan (filters out transient changes during active downloads).

4. **`watcher.go`** — The scan mutex (2B) already protects against concurrent scans.

### 2E. Skip-Unchanged Optimization

**Problem**: `scanMusicDir` calls `dbUpsertTrack` for EVERY track on every scan, even unchanged ones.

**Changes:**

1. **`scanner.go`** — Before `dbUpsertTrack`, compare `ModTime`:
   ```go
   if existing, ok := existingTracks[prefix+":"+relPath]; ok {
       if existing.ModTime == info.ModTime().Unix() && !relChanged {
           continue // skip — file unchanged
       }
   }
   ```
   Only upsert when the file is new or its ModTime has changed.

---

## Phase 3: Search/Ripper Fixes (Go + JS)

### 3A. Fix O(n*m) Duplicate Detection

**Problem**: Recording search, release search, release tracks, and artist tracks all do O(n*m) linear scans of the library for each result. Artist search is efficient (builds a map) — inconsistent.

**Changes:**

1. **`handlers.go:2179` (`checkDuplicateInLibrary`)** — Build a lookup map once, pass it to callers. Add a batch version:
   ```go
   func buildLibraryLookup() map[string]bool {
       mu.RLock()
       defer mu.RUnlock()
       m := make(map[string]bool, len(tracks)*2)
       for _, t := range tracks {
           m[strings.ToLower(t.Artist+"|"+t.Title)] = true
       }
       return m
   }
   ```

2. **`musicbrainz.go`** — Refactor `finderSearchRecordings`, `finderSearchReleases`, `finderReleaseTracks`, `finderArtistTracks` to use `buildLibraryLookup()` once and do O(1) lookups per result.

### 3B. Cover Art Server-Side Cache for Finder

**Problem**: Each finder search result with an `albumId` generates an `<img src="/api/finder/cover/{mbid}">` that hits Cover Art Archive with no server cache.

**Changes:**

1. **`handlers.go:1657-1691` (`finderCoverHandler`)** — Cache fetched cover art to `musicDir/images/finder/{mbid}.jpg`. Check disk first, then fetch from Cover Art Archive.

### 3C. Persist Search History (localStorage)

**Problem**: `_finderHistory` is an instance variable, lost on refresh.

**Changes:**

1. **`js/ui.js:1999`** — Initialize from localStorage:
   ```javascript
   this._finderHistory = JSON.parse(localStorage.getItem('finderHistory') || '[]');
   ```

2. **`js/ui.js:2499-2504` (`_addSearchHistory`)** — Persist to localStorage on add:
   ```javascript
   localStorage.setItem('finderHistory', JSON.stringify(this._finderHistory));
   ```

### 3D. Refresh _downloadJobs on Each Search

**Problem**: `_downloadJobs` is loaded once and never refreshed, causing stale "Queued" badges.

**Changes:**

1. **`js/ui.js:2481-2482`** — Remove the lazy-cache pattern. Instead, fetch fresh queue data at the start of each `_renderFinderResults` call (or at least every 30s via the existing poll timer).

---

## Phase 4: Settings Cleanup + New Settings

### 4A. Remove Dead Settings (Go)

**`settings.go`** — Remove these `migrateSetting` calls:
- `download_concurrent` (line 15) — dead, downloadSem is hardcoded
- `review_check_naming` (line 23) — dead on both sides
- `review_check_duration` (line 25) — dead on both sides

### 4B. Fix the Duplicate Review Setting

**Problem**: UI checkbox "Potential Duplicates" writes to `review_flag_duplicates` (dead), but Go reads `review_check_duplicates` (no UI).

**Fix**: Change Go to read `review_flag_duplicates` instead of `review_check_duplicates`:
- **`review.go:739`** — Change `getSettingBool("review_check_duplicates", true)` to `getSettingBool("review_flag_duplicates", true)`.
- Remove `review_check_duplicates` from `settings.go:24`.
- Remove `review_flag_duplicates` from the dead-settings list — it's now alive.

### 4C. Add New Worker Settings (Go + JS)

**`settings.go`** — Add new `migrateSetting` calls:
```go
migrateSetting("watcher_enabled", "true")
migrateSetting("watcher_interval", "30")
migrateSetting("cover_fetch_enabled", "true")
migrateSetting("artist_art_fetch_enabled", "true")
```

(`review_recheck_hours` already exists at line 26 — just needs UI.)

### 4D. Clean Up JS Save/Load Functions

**`js/ui.js`** — In `_loadFinderSettings` and `_saveFinderSettings`:
- Remove `download_concurrent` references (lines 3255, 3460)
- Remove `review_check_naming`, `review_check_duplicates`, `review_check_duration` from the orphaned getElementById + save patterns (lines 3269-3275, 3478-3485)
- Add loading/saving for new settings: `watcher_enabled`, `watcher_interval`, `cover_fetch_enabled`, `artist_art_fetch_enabled`, `review_recheck_hours`

---

## Phase 5: Settings Page Restructure

### New Section Layout (Moderate Reorganization)

Reorganize the 8 existing sections into 5 logical groups:

**1. Playback**
- Waveform Style select + preview + save (unchanged from current Section 2)

**2. Downloads & Ripper**
- Audio Format, MP3 Quality, Opus Bitrate (conditional)
- Minimum Bitrate
- Convert to FLAC toggle
- Organise by Artist toggle
- Enable Downloads toggle
- Bulk Import textarea + button
- (REMOVED: Max Concurrent Downloads — dead setting)
- (REMOVED: Album Subdirectory — dead variable, path logic uses Artist/Album directly)

**3. Metadata & Review**
- MusicBrainz Metadata: Scan button, Review Pending, Match History
- Track Review: Enable toggle, progress bar, live log
- Review Checks: Metadata checks (6 toggles), Quality checks (3 toggles)
- Recheck Hours input (NEW — surfaces `review_recheck_hours`)
- Recheck All + Copy Log buttons
- (FIXED: "Potential Duplicates" now actually controls `review_flag_duplicates` which Go reads)

**4. Library & Workers** (NEW SECTION)
- Rescan Library button
- File Watcher: Enable toggle + Poll Interval input (NEW)
- Cover Art Fetch: Enable toggle (NEW)
- Artist Art Fetch: Enable toggle (NEW)
- Downloadable Tracks: Enable toggle + Manage Per-Track

**5. About**
- Static text (unchanged)

### Implementation Steps for Restructure

1. **`js/ui.js:3009-3241` (`renderSettings`)** — Rewrite the HTML generation to produce the new 5-section layout. Reuse existing CSS classes (`.settings-section`, `.settings-field`, `.settings-toggle`, etc.).

2. **`js/ui.js:3243-3318` (`_loadFinderSettings`)** — Update to load/save the new element IDs. Add new settings. Remove dead ones.

3. **`js/ui.js:3447-3474` (`_saveFinderSettings`)** — Update to save all download/worker settings in one call. Remove dead keys.

4. **`js/ui.js:3476-3498` (`_saveReviewSettings`)** — Clean up dead review_check_* references. Add review_recheck_hours.

5. **`css/settings.css`** — Add `.settings-form-grid` and `.settings-toggles-row` CSS (currently undefined). Add `.settings-subsection-label` for the METADATA CHECKS / QUALITY CHECKS subheadings.

---

## Execution Order

1. Phase 1A (Go review bug fix) — verify with `go build -mod=vendor -o server .`
2. Phase 1B (9 UI fixes) — verify by loading in browser
3. Phase 2A-2E (worker efficiency) — verify with `go build`
4. Phase 3A-3D (search fixes) — verify with `go build`
5. Phase 4A-4D (settings cleanup) — verify with `go build`
6. Phase 5 (settings page restructure) — verify in browser

## Verification

- `go build -mod=vendor -o server .` after each Go phase
- Manual browser testing after each JS phase
- Watch server logs for: no more `[review] Checking batch of N tracks` infinite spam
- Check settings page renders all sections correctly
- Verify cover/art fetch doesn't double-run after manual scan
