# MusicApp — Structural Analysis

## What It Is

A self-hosted music server. Single Go binary serves a vanilla JS/CSS single-page application. Scans local music directories, streams audio over HTTP, downloads from YouTube via yt-dlp, fetches metadata from MusicBrainz, and manages a library with playlists, favorites, review workflows, and a download queue.

---

## File Tree (source files only)

```
musicapp/
├── server.go              # Entry point, main(), route registration, HTTP server startup
├── handlers.go            # All HTTP API handlers (2814 lines)
├── database.go            # SQLite schema, migrations, all DB access functions
├── scanner.go             # Music directory scanning, tag reading, cover extraction
├── models.go              # Data structs (Track, Album, Artist, Playlist, etc.)
├── watcher.go             # Polling filesystem watcher for live library updates
├── downloads.go           # yt-dlp download jobs, YouTube search, audio validation
├── musicbrainz.go         # MusicBrainz API client, Cover Art Archive, Deezer artist art, Finder search
├── waveform.go            # Audio waveform generation via ffmpeg
├── settings.go            # Settings stored in SQLite key-value table
├── state.go               # Shared helpers (timeNow)
├── review.go              # Track review worker, flag detection, duplicate checking
├── ids.go                 # ID generation (SHA-256 based, UUID, album ID)
├── autosort.go            # Auto-sort files into Artist/Album directory structure
├── watched.go             # YouTube playlist watching and auto-downloading
├── index.html             # SPA shell, mini-player markup, tab bar, now-playing overlay
├── admin.html             # Admin panel (file browser, upload, download management)
├── ripperv2.html           # Standalone ripper page
├── js/
│   ├── app.js             # App bootstrap, Player/Store/UI wiring, URL routing, deep links
│   ├── api.js             # All /api/* fetch calls as async functions
│   ├── store.js           # Client-side state: library cache, playlists, favorites, settings
│   ├── player.js          # HTML5 Audio wrapper, queue, shuffle, repeat, MediaSession API
│   ├── ui.js              # All DOM rendering (6279 lines): pages, now-playing, modals, context menus
│   ├── review.js          # ReviewUI overlay in now-playing: flag display, mark-ok, edit-meta modal
│   ├── ripperv2.js        # RipperV2 module: MusicBrainz search, download queue UI, batch import
│   └── icons.js           # SVG icon functions (home, play, pause, shuffle, etc.)
├── css/
│   ├── base.css           # CSS reset, variables, typography, scrollbar
│   ├── layout.css         # App shell layout: header, content, tab bar
│   ├── components.css     # Reusable components: buttons, cards, inputs, badges
│   ├── track-list.css     # Track list rows, album/artist cards
│   ├── pages.css          # Page-specific styles (home, settings, artist, album views)
│   ├── now-playing.css    # Full-screen now-playing view, seek bar, waveform
│   ├── mini-player.css    # Bottom mini player bar
│   ├── modals.css         # Modal dialogs
│   ├── settings.css       # Settings page layout
│   ├── review.css         # Review overlay, flag badges, edit-metadata modal
│   ├── ripperv2.css       # Ripper v2 page styles
│   ├── finder.css         # Music finder (MusicBrainz browse) styles
│   ├── animations.css     # Keyframe animations
│   ├── responsive.css     # Mobile responsive breakpoints
│   └── styles.css         # Aggregate @import of all above CSS files
├── scripts/
│   └── enrich.py          # Python enrichment pipeline: MusicBrainz genres, cover art embedding, lyrics via lrclib
├── Dockerfile             # Multi-stage build: Go compile → Alpine with python3, ffmpeg, yt-dlp
├── .gitlab-ci.yml         # GitLab CI: build Docker image, deploy container on push to main
├── go.mod                 # Go module: musicapp, Go 1.26
├── go.sum                 # Dependency checksums
└── vendor/                # Vendored Go dependencies (committed)
```

---

## Architecture

### Single Go Binary, Single Package

All `.go` files are `package main` at the repo root. No subpackages. Compiled into one binary.

```
Entry: server.go → main()
  ├── Init: parse flags, resolve music dirs, init SQLite
  ├── Load: DB → memory (tracks map, albums map, cover cache)
  ├── Scan: if file counts changed, rescan music directories
  ├── Background goroutines:
  │   ├── startWatcher()        — polls dirs every 30s for file count changes
  │   ├── startWatchScheduler() — refreshes watched YouTube playlists hourly
  │   ├── downloadWatchdog()    — kills stalled downloads, restarts queue
  │   ├── fetchMissingCovers()  — background MusicBrainz cover fetch
  │   ├── fetchMissingArtistArt() — background Deezer artist image fetch
  │   └── startReviewScheduler()  — flags tracks with bad metadata
  └── HTTP: net/http ServeMux with ~70 route patterns
```

### In-Memory State

```
Global maps protected by sync.RWMutex:
  tracks     map[string]*Track    — all tracks, keyed by ID
  albums     map[string]*Album    — all albums, keyed by album ID
  coverCache map[string][]byte    — cover art JPEG bytes, keyed by album ID
  artistArtCache map[string][]byte — artist images, keyed by lowercased name
```

SQLite is the persistence layer (`data/music.db`). On startup, tracks/albums are loaded from DB. If file counts match, the full directory scan is skipped. Schema uses `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` for migration (no migration framework).

### File Path Scheme

Multi-directory support via prefix scheme:
- Primary music dir: `relative/path/to/file.mp3` (no prefix)
- Media dir: `media:relative/path/to/file.mp3`

`resolveFilePath()` expands prefixed paths to absolute paths. `musicDirForPath()` determines the root dir for a given path (used for writing covers).

### ID Generation

- Track ID: `SHA-256(filePath)[:12]` — deterministic, same file always gets same ID
- Album ID: `SHA-256(lowercase(artist|album))[:12]`
- UUID: random 128-bit for playlists, jobs, matches

---

## Backend Modules

### server.go (331 lines)

- `main()`: flag parsing, directory resolution, DB init, scan logic, goroutine launching, route registration, HTTP server start
- `recoveryMiddleware`: catches panics in handlers
- `loggingMiddleware`: logs API request method/path/duration

### handlers.go (2814 lines)

All HTTP handlers. Largest file. Key handler groups:

| Route Pattern | Handler | Purpose |
|---|---|---|
| `/api/library` | `libraryHandler` | Returns all tracks, albums, artists |
| `/api/stats` | `statsHandler` | Track/album counts, library version |
| `/api/stream/{id}` | `streamHandler` | Audio streaming with Range support |
| `/api/cover/{albumID}` | `coverHandler` | Album cover art (memory → disk → SVG fallback) |
| `/api/artist-art/{name}` | `artistArtHandler` | Artist image (memory → disk → album cover → SVG) |
| `/api/scan` | `scanHandler` | Trigger manual rescan |
| `/api/playlists` | CRUD | Playlist management |
| `/api/favorites` | CRUD | Favorite toggling |
| `/api/recent` | CRUD | Recently played |
| `/api/metadata/*` | Various | MusicBrainz scan, approve/reject matches |
| `/api/finder/*` | Various | MusicBrainz browse (recordings, artists, releases) |
| `/api/queue/*` | Various | Download job queue |
| `/api/download/{id}` | `downloadHandler` | Download track file |
| `/api/waveform/{id}` | `waveformHandler` | Waveform peak data |
| `/api/review/*` | Various | Track review flags, mark-ok, edit metadata, delete |
| `/api/settings` | GET/POST | App settings |
| `/api/watch/*` | Various | Watched YouTube playlists |
| `/api/v2/resolve-url` | `resolveURLHandler` | yt-dlp URL resolution |
| `/api/v2/search` | `v2SearchHandler` | Python enrichment search |
| `/api/v2/lyrics` | `v2LyricsHandler` | Lyrics via lrclib |
| `/api/preview/{videoID}` | `previewAudioHandler` | YouTube audio stream URL |
| `/api/shared-queue` | CRUD | Shareable queue links |
| `/admin` | `adminHandler` | Admin panel (cookie auth) |

SPA catch-all: any non-`/api/` path serves `index.html` with optional OpenGraph meta tags for deep links.

### database.go (697 lines)

SQLite via `modernc.org/sqlite` (pure Go, no CGo). WAL mode.

Tables:
- `tracks` — id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata, orig_* columns for undo
- `albums` — id, name, artist, track_count, year, has_cover
- `favorites` — track_id, added_at
- `recent` — track_id, position (capped at 50)
- `playlists` / `playlist_tracks` — playlist definitions with ordered track references
- `metadata_matches` — MusicBrainz match candidates with status (pending/approved/rejected)
- `downloads` — per-track download enable/disable toggle
- `download_jobs` — yt-dlp job queue with full metadata
- `shared_queues` — shareable queue links
- `watched_playlists` / `watched_playlist_tracks` — YouTube playlist monitoring
- `settings` — key-value app settings
- `track_reviews` — review status and flags per track

Key design: `dbUpsertTrack` uses `ON CONFLICT DO UPDATE` with conditional logic — if `has_metadata = 1`, tag fields are preserved (not overwritten by scanner).

### scanner.go (606 lines)

- `scanMusicDir(dir)` / `scanMusicDirWithPrefix(dir, prefix)`: walks directory, reads audio tags via `github.com/dhowden/tag`, builds Track/Album objects, writes to DB in a transaction
- ModTime optimization: skips tag reading if file hasn't changed
- Folder-based artist inference: if path is `Artist/Album/track.mp3`, uses `Artist` as fallback
- `extractEmbeddedCovers()`: extracts cover art from file tags to `music/images/{albumID}.jpg`
- `scanSingleFile(filePath)`: used after download completes
- `generatePlaceholderSVG()`: deterministic color SVG based on name hash

### watcher.go (140 lines)

Polling-based. Not filesystem events.
- Counts audio files in each music directory
- Compares current count to stored count
- If changed, debounces 5s, then triggers full rescan
- Interval configurable via `watcher_interval` setting (default 30s)

### downloads.go (1060 lines)

Download pipeline:
1. Job created → status `queued`
2. `processDownloadQueue()`: semaphore-limited (max 3 concurrent)
3. `processSingleDownload()`:
   - Search YouTube via yt-dlp `--dump-json` with scoring
   - If confidence < 40, enters `needs_selection` state for user choice
   - Download via yt-dlp (format selection, conversion to FLAC/MP3/Opus)
   - Validate audio integrity via ffprobe
   - Check minimum bitrate threshold
   - Tag file via ffmpeg or Python enrichment script
   - `scanSingleFile()` to add to library
   - Add to playlist if `playlistId` set

YouTube search scoring:
- Channel name match: +60
- Title match: +50
- Penalizes: karaoke, instrumental, cover, live, remix, mashup, etc.
- Bonuses: "official", "audio", "lyric"

Watchdog: kills jobs running >11 minutes, restarts stalled jobs on startup.

### musicbrainz.go (1814 lines)

MusicBrainz API client:
- Recording/release/release-group search with Lucene queries
- Cover Art Archive fetch
- Release type priority (Album > EP > Single > Soundtrack > Live > Remix > Compilation)
- Best release resolution for recordings (prefers real albums over compilations)
- Artist image fetch from Deezer API (free, no key)
- Finder search: recordings, artists, releases with library-cross-reference
- `scanMetadataForTracks()`: batch scan of unmatched tracks (2 workers, rate-limited)
- `applyApprovedMatches()`: applies approved MusicBrainz matches to in-memory tracks
- `rebuildAlbumsFromTracks()`: rebuilds album map from track data

### review.go (939 lines)

Automated track review system:
- Statuses: `unchecked` → `needs_review` or `reviewed_ok`
- Flag checks:
  - Metadata completeness: missing title, artist, album, genre, cover
  - Suspicious naming: podcast, video, cover, karaoke keywords; title=artist; very short/long titles
  - Filename-derived: title matches filename stem
  - Duration: <30s short, >9min with other flags = long
  - Duplicates: title similarity ≥ 0.95 across same artist, keeps highest quality
- Review worker: batch processes 50 unchecked tracks, then sleeps until woken or timeout
- API: mark-ok, edit-metadata, delete, recheck-all, progress, log

### waveform.go (156 lines)

- Decodes audio to raw PCM via ffmpeg (mono, 8kHz, s16le)
- Buckets samples into 300 peaks (max amplitude per bucket)
- Normalizes peaks to 0.0-1.0
- Caches as JSON in `music/images/waveforms/{trackID}.json`

### autosort.go (88 lines)

- After metadata scan, moves files into `Artist/Album/filename.ext` structure
- Only touches primary music dir files
- Uses `os.Rename` then triggers rescan

### watched.go (348 lines)

YouTube playlist monitoring:
- Extracts playlist tracks via yt-dlp `--flat-playlist`
- Parses artist/title from video titles (tries separators: ` - `, ` – `, ` | `, ` — `)
- Creates/maintains a library playlist matching the YouTube playlist name
- Auto-downloads missing tracks via download queue
- Hourly refresh via `startWatchScheduler()`

### ids.go (25 lines)

Three ID functions:
- `generateID(input)`: SHA-256 → first 12 hex chars
- `generateUUID()`: random 128-bit UUID format
- `generateAlbumID(artist, album)`: SHA-256 of `lower(artist|album)` → 12 hex

### settings.go (98 lines)

Key-value settings in SQLite. Default values seeded on first run. Settings include download format, watcher interval, review flags, cover fetch toggle, etc.

### state.go (9 lines)

Single helper: `timeNow()` returns UTC RFC3339 timestamp.

---

## Frontend

### Architecture

No framework. Vanilla JS with module-pattern objects. No build step. All JS loaded via `<script>` tags in `index.html`.

```
App.init()
  ├── Player.init()        — HTML5 Audio, MediaSession API
  ├── UI.init()             — DOM caching, event binding
  ├── ReviewUI.init()       — Review overlay setup
  ├── Store.init()          — Fetch all data from API in parallel
  └── UI.renderPage()       — Render current view
```

### js/app.js (111 lines)

Bootstrap. Wires Player callbacks to UI updates. Handles URL routing (`/settings`, `/ripperv2`). Deep links: `?play=TRACK_ID`, `?q=SHARED_QUEUE_ID`.

### js/api.js (557 lines)

All `/api/*` HTTP calls as async functions. Covers: library, playlists, favorites, recent, scan, metadata, downloads, queue, settings, reviews, watched playlists, finder, YouTube search, v2 enrichment, shared queues.

### js/store.js (143 lines)

Client-side state object. Caches: library (tracks/albums/artists), playlists, favorites, recent, settings, review counts. Home layout stored in localStorage.

### js/player.js (328 lines)

HTML5 Audio wrapper:
- Queue management (play, next, prev, shuffle, repeat off/all/one)
- MediaSession API for lock screen / keyboard media key controls
- Reports duration back to server for tracks that lack it
- Waveform seek (click-to-position on waveform visualization)

### js/ui.js (6279 lines)

The entire UI renderer. No virtual DOM, no templates. String concatenation building HTML.
- Page rendering: home, library, artist, album, playlist, favorites, settings, search
- Now-playing full screen view
- Mini player bar
- Modal system (playlist picker, metadata edit, context menu)
- Seek bar, volume bar, waveform rendering
- Queue panel with drag-to-reorder
- Color extraction from cover art (canvas sampling)
- Download badge polling
- Responsive layout handling

### js/review.js (234 lines)

ReviewUI module embedded in now-playing view:
- Shows overlay when current track has `needs_review` status
- Dropdown with flag descriptions and actions (mark ok, edit metadata, delete)
- Edit metadata modal with field inputs

### js/ripperv2.js (546 lines)

Standalone ripper/downloader page:
- MusicBrainz search for recordings/releases
- Release track listing with download buttons
- Download queue management (retry, delete, select video)
- Batch import from text
- YouTube playlist import
- URL paste resolution

### js/icons.js (146 lines)

SVG icon functions returning inline SVG strings.

### CSS (15 files, ~6000 lines total)

Split by concern. `styles.css` aggregates all via `@import`. CSS custom properties for theming. Dark theme (background `#0E0E0E`, accent `#D4F040`).

---

## API Surface

~70 HTTP route patterns. Summary by domain:

**Library**: `/api/library`, `/api/stats`, `/api/scan`

**Playback**: `/api/stream/{id}`, `/api/cover/{id}`, `/api/artist-art/{name}`, `/api/waveform/{id}`

**Collections**: `/api/playlists`, `/api/favorites`, `/api/recent`

**Downloads**: `/api/download/{id}`, `/api/queue`, `/api/queue/add`, `/api/queue/add-batch`

**Metadata**: `/api/metadata/scan`, `/api/metadata/rescan/{id}`, `/api/metadata/approve/{id}`, etc.

**Finder**: `/api/finder/search`, `/api/finder/artist/{mbid}`, `/api/finder/release/{mbid}`, `/api/finder/cover/{mbid}`

**Review**: `/api/review/tracks`, `/api/review/counts`, `/api/review/mark-ok`, `/api/review/edit-meta`, etc.

**Admin**: `/api/files`, `/api/upload`, `/api/delete`, `/api/folders` (all cookie-authenticated)

**V2 Pipeline**: `/api/v2/resolve-url`, `/api/v2/search`, `/api/v2/lyrics`

**Other**: `/api/settings`, `/api/shared-queue`, `/api/playlist-import`, `/api/watch/*`, `/api/preview/{id}`

---

## Data Flow

```
Disk (music dirs)
  ↓ scanner.go (filepath.Walk + tag.ReadFrom)
  ↓
In-memory maps (tracks, albums) + SQLite (data/music.db)
  ↓
HTTP handlers → JSON API responses
  ↓
Frontend (fetch → Store → UI renders)
```

### Download Flow

```
User triggers download (ripper / finder / watched playlist)
  ↓
POST /api/queue/add → createDownloadJob() → SQLite download_jobs
  ↓
processDownloadQueue() goroutine picks up job
  ↓
yt-dlp search → score → download → ffmpeg tag → scanSingleFile()
  ↓
Track added to in-memory maps + SQLite + review queue
```

### Metadata Enrichment Flow

```
scanMetadataForTracks() — finds tracks with missing tags
  ↓
MusicBrainz recording search (2 workers, rate-limited)
  ↓
Score candidates → insert as pending metadata_matches
  ↓
Auto-approve score ≥ 0.8
  ↓
applyApprovedMatches() — updates in-memory tracks + SQLite
  ↓
Cover Art Archive fetch → music/images/{albumID}.jpg
```

---

## External Dependencies

### Runtime (Go binary)
| Dependency | Purpose |
|---|---|
| `github.com/dhowden/tag` | Audio file tag reading (MP3, FLAC, M4A, OGG, etc.) |
| `modernc.org/sqlite` | Pure-Go SQLite (no CGo) |
| `github.com/google/uuid` | UUID generation |

### Runtime (external tools)
| Tool | Purpose | Required |
|---|---|---|
| `yt-dlp` | YouTube search and download | No (downloads fail without it) |
| `ffmpeg` | Audio conversion, tagging, waveform generation, integrity validation | No (features degrade) |
| `python3` + `mutagen` + `musicbrainzngs` + `lyriq` | V2 enrichment pipeline (genres, cover embedding, lyrics) | No (falls back to ffmpeg tagging) |

### External APIs
| API | Purpose |
|---|---|
| MusicBrainz (`musicbrainz.org/ws/2`) | Metadata search (recordings, releases, artists) |
| Cover Art Archive (`coverartarchive.org`) | Album cover art |
| Deezer (`api.deezer.com`) | Artist images |
| lrclib (via enrich.py) | Lyrics |
| YouTube | Audio source for downloads |

---

## Deployment

- **Docker**: Multi-stage build. Go compile on `golang:1.26-alpine`, run on `alpine:latest` with python3, ffmpeg, yt-dlp pre-installed.
- **GitLab CI**: On push to `main`, builds image, stops old container, starts new one. Port 8298 → 8081.
- **Volumes**: `/app/data` (SQLite DB), `/music` (primary library), `/media-music` (secondary read-only library).
- **Environment**: `MUSIC_DIR`, `MEDIA_MUSIC_DIR`, `PORT` (default 8081).

---

## Key Design Characteristics

- **Monolithic**: Single binary, single package, no code splitting beyond file organization
- **In-memory first**: All tracks/albums loaded into Go maps. DB is persistence layer, not primary access path
- **Polling watcher**: Not fsnotify. Counts files every 30s, debounces, rescans on change
- **Optimistic scan skip**: If file count matches DB, skip full scan on startup
- **ModTime caching**: Individual files skip tag reading if modification time unchanged
- **No test suite**: No test files exist
- **No build step for frontend**: Plain JS/CSS served as static files
- **Admin auth**: Hardcoded passcode with cookie-based session
- **Cover art pipeline**: Embedded tags → disk cache → MusicBrainz/Cover Art Archive → SVG placeholder
- **Two download pipelines**: Default (ffmpeg tagging) and V2 (Python enrichment with genres, lyrics, cover embedding)
- **Review system**: Background worker flags tracks with missing/bad metadata, duplicate detection via title similarity scoring
