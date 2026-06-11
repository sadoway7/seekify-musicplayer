# MusicApp - Complete Learning Map

> JSON/HTML hybrid knowledge map of the entire application.  
> Last updated: deep-dive exploration of all source files.

---

## FILE TREE

```
musicapp/
├── server.go          # main(), startup, route registration, middleware
├── handlers.go        # ALL HTTP API handlers (~2145 lines)
├── database.go        # SQLite schema, all queries, migrations
├── downloads.go       # yt-dlp download job system
├── musicbrainz.go     # MusicBrainz metadata, cover art, finder search
├── scanner.go         # music file scanning, tag reading via dhowden/tag
├── watcher.go         # filesystem watcher (polling-based, 30s interval)
├── watched.go         # YouTube playlist watching/syncing
├── waveform.go        # audio waveform generation via ffmpeg
├── models.go          # data structs (Track, Album, Artist, Playlist, etc.)
├── settings.go        # app settings (SQLite key/value store)
├── state.go           # shared helper: timeNow()
├── ids.go             # ID generation (SHA-256, UUID, albumID)
├── autosort.go        # auto-sort files into Artist/Album/ dirs
├── index.html         # SPA shell: tab bar, mini-player, now-playing, modals
├── admin.html         # standalone admin file manager page
├── js/
│   ├── app.js         # App.init() - bootstrap, deep link handling
│   ├── api.js         # Api object - all HTTP calls to backend
│   ├── player.js      # Player object - HTML5 Audio, queue, shuffle, repeat
│   ├── store.js       # Store object - in-memory library/favorites/recent/playlists
│   ├── ui.js          # UI object - ALL rendering and DOM binding (~5431 lines)
│   └── icons.js       # Icons object - SVG icon helper functions
├── css/
│   ├── styles.css       # imports all other CSS
│   ├── base.css         # CSS variables, resets
│   ├── components.css   # shared component styles
│   ├── layout.css       # app layout, header, content
│   ├── track-list.css   # track row styling
│   ├── pages.css        # page-specific styles
│   ├── responsive.css   # media queries
│   ├── settings.css     # settings page
│   ├── now-playing.css  # now playing full screen
│   ├── modals.css       # modal overlays
│   ├── mini-player.css  # bottom mini player bar
│   ├── finder.css       # ripper/finder tab
│   └── animations.css   # keyframe animations
├── Dockerfile
├── .gitlab-ci.yml
└── vendor/             # Go dependencies (committed)
```

---

## ARCHITECTURE

```json
{
  "type": "SPA + Go backend",
  "frontend": "vanilla JS (no framework), plain CSS",
  "backend": "single Go binary, single package main",
  "database": "SQLite (WAL mode) at data/music.db",
  "audioPlayback": "HTML5 Audio element (client-side streaming)",
  "downloadEngine": "yt-dlp + ffmpeg (external binaries)",
  "metadataSource": "MusicBrainz API + Cover Art Archive",
  "artistImages": "Deezer API (free, no key)",
  "port": "8081 (default, configurable via PORT env)",
  "entrypoint": "server.go (NOT main.go)"
}
```

---

## STARTUP SEQUENCE

```html
<ol>
<li>Parse <code>-dir</code> flag or <code>MUSIC_DIR</code> env → resolve music directory</li>
<li>Initialize <code>musicDirs</code> map: <code>""</code> → primary, optionally <code>"media"</code> → MEDIA_MUSIC_DIR</li>
<li>Init in-memory maps: tracks, albums, coverCache</li>
<li><code>initDB("data/music.db")</code> → create tables, run migrations, import old JSON state</li>
<li>Load tracks/albums from DB (<code>dbLoadTracks</code>, <code>dbLoadAlbums</code>)</li>
<li>If file counts differ from DB: full scan (<code>scanMusicDir</code>)</li>
<li><code>applyApprovedMatches()</code> → apply any approved metadata overrides</li>
<li><code>extractEmbeddedCovers()</code> → write cover art to disk</li>
<li><code>syncWatchedPlaylistsToLibrary()</code></li>
<li><code>recoverStalledDownloads()</code> → reset stuck jobs to "queued"</li>
<li>Background goroutines:
  <ul>
    <li><code>fetchMissingCovers()</code></li>
    <li><code>fetchMissingArtistArt()</code></li>
    <li><code>startWatcher()</code> — polls filesystem every 30s</li>
    <li><code>startWatchScheduler()</code> — refreshes watched playlists hourly</li>
    <li><code>downloadWatchdog()</code> — kills stalled downloads every 2min</li>
  </ul>
</li>
<li>Register all HTTP routes</li>
<li>Listen on PORT, auto-open browser</li>
</ol>
```

---

## FRONTEND: JS MODULES

```json
{
  "App": {
    "file": "js/app.js",
    "purpose": "Bootstrap and deep link handling",
    "init_flow": [
      "Player.init()",
      "Wire Player callbacks (onStateChange, onTimeUpdate, onTrackChange, onQueueChange)",
      "UI.init()",
      "Store.init() — parallel fetch: library + playlists + favorites + recent + settings",
      "UI.renderPage()",
      "UI.updateMiniPlayer()",
      "Handle deep links: ?play, ?q, ?artist, ?album, ?playlist"
    ]
  },
  "Api": {
    "file": "js/api.js",
    "purpose": "All HTTP calls to backend",
    "methods": [
      "getLibrary(), streamUrl(id), downloadUrl(id), coverUrl(albumId), artistArtUrl(name)",
      "scan(), getPlaylists(), createPlaylist(name), updatePlaylist(id, data), deletePlaylist(id)",
      "getFavorites(), toggleFavorite(trackId)",
      "getRecent(), addRecent(trackId)",
      "getFiles(path), uploadFiles(files, path), deleteFile(path), createFolder(path, name)",
      "metadataScan(), metadataScanProgress(), metadataPending(), metadataAll()",
      "metadataApprove(id), metadataReject(id), metadataApproveAll(), metadataClear()",
      "metadataRescanTrack(trackId), metadataRescanSync(trackId), metadataUpdateTrack(id, data)",
      "metadataCounts(), metadataUndo(id)",
      "getDownloadable(), toggleDownload(trackId), enableAllDownloads()",
      "getWaveform(trackId), reportDuration(trackId, duration)",
      "finderSearch(query, type), finderYouTubeSearch(query)",
      "finderArtistReleases(mbid), finderArtistTracks(mbid, name), finderReleaseTracks(mbid)",
      "queueAdd(track), queueAddBatch(tracks, overrideDir), getQueue(limit)",
      "retryJob(id), deleteJob(id), clearCompletedJobs(), getQueueCounts()",
      "bulkImport(lines)",
      "getSettings(), saveSettings(settings)",
      "importPlaylist(url)",
      "getWatched(), watchPlaylist(url), refreshWatch(id), deleteWatch(id), toggleWatch(id, watching)",
      "previewUrl(videoId), downloadJobUrl(jobId)",
      "shareQueue(trackIds), getSharedQueue(id)"
    ]
  },
  "Player": {
    "file": "js/player.js",
    "purpose": "HTML5 Audio wrapper with queue management",
    "state": {
      "audio": "HTMLAudioElement",
      "queue": "Track[] — current play queue",
      "_originalQueue": "Track[] — saved before shuffle for unshuffle",
      "currentIndex": "int",
      "shuffle": "bool",
      "repeat": "'off' | 'all' | 'one'",
      "playing": "bool",
      "volume": "float 0-1",
      "source": "{type, name, id?} — where the queue came from"
    },
    "methods": [
      "play(track, trackList, source) — play track, optionally setting queue",
      "playInQueue(index) — jump to specific queue position",
      "pause(), togglePlay()",
      "next(), prev() — prev restarts if >3s in, otherwise goes back",
      "seek(fraction), setVolume(v)",
      "toggleShuffle() — Fisher-Yates shuffle, saves original",
      "cycleRepeat() — off → all → one → off",
      "addToQueue(track), removeFromQueue(index), moveInQueue(from, to)",
      "playNextInQueue(track) — inserts after current",
      "clearQueue() — keeps current track only",
      "getCurrentTrack(), getProgress(), isSingleMode(), getSourceName()"
    ],
    "mediaSession": "Uses Media Session API for lock screen controls"
  },
  "Store": {
    "file": "js/store.js",
    "purpose": "In-memory data cache",
    "state": {
      "library": "{tracks: Track[], albums: Album[], artists: Artist[]}",
      "playlists": "Playlist[]",
      "favorites": "string[] (track IDs)",
      "recent": "string[] (track IDs, ordered)",
      "currentTab": "string — active tab name",
      "currentView": "string — current page/view name",
      "viewData": "object — data for current view (albumId, artistName, etc.)",
      "downloadsEnabled": "bool — from settings",
      "waveformStyle": "string — from settings"
    },
    "methods": [
      "init() — parallel fetch all data",
      "refreshLibrary(), refreshPlaylists(), refreshFavorites(), refreshRecent()",
      "getTrack(id), getAlbum(id), albumHasCover(albumId)",
      "getArtistTracks(name), getArtistAlbums(name), getAlbumTracks(albumId)",
      "isFavorite(trackId), getPlaylist(id)"
    ]
  },
  "UI": {
    "file": "js/ui.js",
    "purpose": "ALL rendering and DOM interaction (~5431 lines)",
    "see_below": true
  },
  "Icons": {
    "file": "js/icons.js",
    "purpose": "SVG icon string generators (home, search, play, pause, heart, etc.)"
  }
}
```

---

## PAGES / VIEWS

```html
<table>
<tr><th>View Name</th><th>Tab</th><th>Render Function</th><th>Description</th></tr>
<tr><td><code>home</code></td><td>Home</td><td><code>renderHome()</code></td><td>Search bar + Recently Played grid + Artists row + Albums row + New Songs + Playlists + Favorites preview</td></tr>
<tr><td><code>search</code></td><td>(hidden)</td><td><code>renderSearch()</code></td><td>Search input + Browse by Genre grid + results (artists + tracks with Play/Shuffle)</td></tr>
<tr><td><code>library</code></td><td>Library</td><td><code>renderLibrary()</code></td><td>Filter chips (Playlists/Albums/Artists) + search + list of items</td></tr>
<tr><td><code>album</code></td><td>—</td><td><code>renderAlbum(albumId)</code></td><td>Hero with cover art + track list + Play/Shuffle + context menu (more)</td></tr>
<tr><td><code>artist</code></td><td>—</td><td><code>renderArtist(name)</code></td><td>Hero with artist art + Albums scroll row + Tracks list + Rip More button</td></tr>
<tr><td><code>playlist</code></td><td>—</td><td><code>renderPlaylist(id)</code></td><td>Hero with first track cover + track list + Share/Delete + context menu</td></tr>
<tr><td><code>favorites</code></td><td>(hidden)</td><td><code>renderFavorites()</code></td><td>Hero with heart icon + favorited tracks list + Play/Shuffle</td></tr>
<tr><td><code>all-music</code></td><td>—</td><td><code>renderAllMusic()</code></td><td>Hero with mosaic banner + all tracks (lazy-loaded 50 at a time)</td></tr>
<tr><td><code>finder</code></td><td>Ripper</td><td><code>renderFinder()</code></td><td>Sub-tabs: Search / Import / Downloads. Search has type chips (Artists/Songs/Albums)</td></tr>
<tr><td><code>finder-artist</code></td><td>—</td><td><code>renderFinderArtist(data)</code></td><td>Artist page in MusicBrainz: sub-tabs Tracklist/Albums + Download All</td></tr>
<tr><td><code>finder-release</code></td><td>—</td><td><code>renderFinderRelease(data)</code></td><td>Album page in MusicBrainz: track list + Download All Tracks</td></tr>
<tr><td><code>settings</code></td><td>Settings</td><td><code>renderSettings()</code></td><td>Password locked ("pancake"). Sections: Library, Waveform, Ripper, Downloads, Bulk Import, Metadata, About</td></tr>
<tr><td><code>metadata-review</code></td><td>—</td><td><code>renderMetadataReview()</code></td><td>Pending metadata matches grouped by track, approve/reject per candidate</td></tr>
<tr><td><code>metadata-history</code></td><td>—</td><td><code>renderMetadataHistory()</code></td><td>All matches with status filter chips + search + Undo button on approved</td></tr>
<tr><td><code>downloads</code></td><td>—</td><td><code>renderDownloads()</code></td><td>Download queue with status badges, retry/delete per job, clear history</td></tr>
</table>
```

### Navigation

```json
{
  "tab_bar": ["Home", "Library", "Ripper", "Settings"],
  "hidden_tabs": ["search", "favorites"],
  "navigation_history": "UI._navHistory[] — stack of {view, data} for back button",
  "navigateTo(view, data)": "pushes to history stack, renders page",
  "navigateBack()": "pops from history stack, or goes home if empty",
  "deep_links": {
    "?play=TRACK_ID": "Load track, show Now Playing (don't auto-play)",
    "?q=QUEUE_ID": "Load shared queue, play, show Now Playing",
    "?artist=NAME": "Navigate to artist page",
    "?album=ID": "Navigate to album page",
    "?playlist=ID": "Play playlist if tracks exist, else navigate to playlist page"
  }
}
```

---

## TAB BAR

```json
{
  "tabs": [
    {"id": "home", "label": "Home", "icon": "house", "always_visible": true},
    {"id": "search", "label": "Search", "icon": "search", "style": "display:none"},
    {"id": "favorites", "label": "Favorites", "icon": "heart", "style": "display:none"},
    {"id": "library", "label": "Library", "icon": "folder", "always_visible": true},
    {"id": "finder", "label": "Ripper", "icon": "magnet", "always_visible": true},
    {"id": "settings", "label": "Settings", "icon": "gear", "always_visible": true}
  ],
  "note": "Search and Favorites tabs are hidden. Search is accessed by clicking the search bar on Home. Favorites is accessed from Library filter or via navigation."
}
```

---

## NOW PLAYING SCREEN

```json
{
  "trigger": "Click mini-player, play a track, or deep link",
  "layout": {
    "mobile": "full-screen overlay slides up",
    "desktop": "full-screen overlay + queue panel on right"
  },
  "components": {
    "header": {
      "chevron_down": "Close (slide down animation)",
      "header_text": "Source name (album, playlist, artist, etc.)",
      "more_button": "Opens track context menu"
    },
    "artwork": {
      "main_img": "Album cover (crossfades on track change)",
      "bg_img": "Blurred background glow from album art dominant color",
      "float_tray": {
        "like_btn": "Toggle favorite (heart filled/outline)",
        "share_btn": "Share track link (Web Share API or clipboard)",
        "rip_btn": "Search artist on MusicBrainz, navigate to finder-artist",
        "download_btn": "Download file (hidden if downloads_enabled=false)"
      }
    },
    "info": {
      "title": "Track title (auto-scrolling marquee if overflows)",
      "artist": "Artist name"
    },
    "waveform": {
      "canvas": "Custom canvas-drawn waveform (5 styles: rounded, mirror, layered, layered-mirror, squiggle)",
      "seek": "Click/drag to seek",
      "hover_highlight": "Highlights region between playhead and cursor",
      "data_source": "Fake flat bars initially, real peaks loaded async from /api/waveform/{id}",
      "animation": "Spring physics animation when new waveform loads",
      "colors": "Dynamic — extracted from album art dominant color"
    },
    "controls": {
      "shuffle": "Toggle shuffle (active state highlights)",
      "prev": "Restart if >3s in, else previous track",
      "play_pause": "Main play/pause button",
      "next": "Next track (greyed out if last and repeat=off)",
      "repeat": "Cycle: off → repeat all → repeat one (shows '1' icon)"
    },
    "volume": {
      "speaker_icon": "Click to mute/unmute",
      "bar": "Click/drag to set volume (0-1)",
      "locations": ["now-playing bottom", "queue panel bottom", "mini-player right"]
    }
  },
  "queue_panel": {
    "toggle": "Queue button in float tray",
    "header": "'Playlist' title + share queue button + close button",
    "list": "Queue items with drag-to-reorder (grip handle)",
    "sections": {
      "history": "Already-played tracks (collapsible, above current)",
      "upnext": "Upcoming tracks (below current, default visible)"
    },
    "per_item": ["Cover art", "Title", "Artist", "More button (context menu)"],
    "share": "Creates shared queue via POST /api/shared-queue, shares link",
    "swipe_close": "Swipe down from header area on mobile"
  }
}
```

---

## MINI PLAYER

```json
{
  "location": "Fixed bottom, above tab bar",
  "shown_when": "A track is loaded (hidden when Now Playing is fullscreen)",
  "components": {
    "progress_bar": "Thin line at top, color from album art",
    "left": "Album art thumbnail + title + artist",
    "center": "Prev / Play-Pause / Next buttons",
    "right": "Volume control (expandable on hover/drag)"
  },
  "click": "Clicking anywhere (not buttons) opens Now Playing",
  "colors": "Background gradient extracted from album art dominant color"
}
```

---

## CONTEXT MENUS

```json
{
  "Track Context Menu (_showTrackContextMenu)": {
    "items": [
      "Add to Queue",
      "Add to Playlist → opens playlist modal",
      "Rescan Metadata → opens rescan modal with MusicBrainz candidates",
      "---divider---",
      "Go to Album",
      "Go to Artist",
      "---divider---",
      "Save File (download)",
      "---divider---",
      "Add/Remove from Favorites (toggle)",
      "Remove from Playlist (only when viewing a playlist)"
    ]
  },
  "Artist Context Menu (_showArtistContextMenu)": {
    "items": ["Play All", "Shuffle", "---", "Fetch Artist Image", "Share"]
  },
  "Album Context Menu (_showAlbumContextMenu)": {
    "items": ["Play", "Shuffle", "---", "Share"]
  },
  "Playlist Context Menu (_showPlaylistContextMenu)": {
    "items": ["Play", "Shuffle", "---", "Share", "Rename", "Delete"]
  },
  "Queue Item Context Menu (_showQueueItemContextMenu)": {
    "items": [
      "Remove from Queue",
      "Play Next",
      "---",
      "Go to Album",
      "Go to Artist",
      "---",
      "Share",
      "Add to Playlist",
      "---",
      "Save File"
    ]
  },
  "Library Playlist Row (list-item-more)": {
    "items": ["Play", "Share", "Delete"]
  }
}
```

---

## MODALS

```json
{
  "Playlist Modal": {
    "id": "playlist-modal",
    "trigger": "'Add to Playlist' from context menu",
    "contents": ["Create New Playlist button (inline form)", "List of existing playlists to add track to"],
    "create_flow": "Click 'Create New Playlist' → inline input appears → type name → Enter/click Create → API call → toast"
  },
  "Context Menu Modal": {
    "id": "context-menu",
    "positioned": "Anchored to trigger element (dropdown positioning)",
    "close": "Click outside or select an item"
  },
  "Rescan Modal": {
    "id": "rescan-modal",
    "trigger": "'Rescan Metadata' from track context menu",
    "contents": "Shows track info + MusicBrainz candidates with scores",
    "action": "Click candidate → updates track metadata → closes modal"
  }
}
```

---

## HOME PAGE SECTIONS

```json
{
  "search_bar": {
    "click": "Navigates to search view, focuses input",
    "readonly": true
  },
  "recently_played": {
    "layout": "Grid (3 mobile, 4 tablet, 5 desktop)",
    "cards": [
      "Shuffle All (accent gradient, dots pattern)",
      "...recent track cards (album cover, title, now-playing badge if current)...",
      "All Music (navigates to all-music view)"
    ],
    "recent_card_click": "Plays track with recent tracks as queue context"
  },
  "artists": {
    "layout": "Horizontal scroll row",
    "count": "6 mobile, 10 desktop (random selection)",
    "click": "Navigate to artist page"
  },
  "albums": {
    "layout": "Horizontal scroll row",
    "count": "15 (random shuffle)",
    "click": "Navigate to album page"
  },
  "new_songs": {
    "sorted_by": "modTime descending (newest first)",
    "limit": "6 initially, 'Show more' adds 12",
    "click": "Plays track"
  },
  "playlists": {
    "count": "Up to 4",
    "click": "Navigate to playlist page"
  },
  "favorites": {
    "count": "Up to 5 tracks",
    "format": "Track list (with album art)"
  }
}
```

---

## SEARCH PAGE

```json
{
  "default_state": "Browse by Genre grid (genres extracted from library tracks, album covers as backgrounds)",
  "search_flow": {
    "input": "Debounced 200ms",
    "matching": "Filters tracks by title + artist + album + genre (all words must match)",
    "results_order": "Artists first, then tracks (sorted by title match quality)",
    "actions": "Play all results / Shuffle results"
  },
  "genre_click": "Filters to tracks with matching genre, shows back button"
}
```

---

## LIBRARY PAGE

```json
{
  "filter_chips": ["Playlists", "Albums", "Artists"],
  "search": "Filters visible items by title/subtitle",
  "playlists_tab": {
    "fixed_items": [
      "Favorites (with count)",
      "All Music (with count)",
      "Create Playlist (inline form on click)"
    ],
    "dynamic": "User playlists with cover art, track count, more button"
  },
  "albums_tab": "List or grid of all albums (with cover art)",
  "artists_tab": "List of all artists (round avatar, album count)"
}
```

---

## RIPPER (FINDER) PAGE

```json
{
  "sub_tabs": ["Search", "Import", "Downloads"],
  "Search_tab": {
    "type_chips": ["Artists", "Songs", "Albums"],
    "input": "Searches MusicBrainz (300ms debounce)",
    "history": "Last 5 searches shown when empty",
    "artist_results": "Round avatar + name + country + type + In Library badge. Click → finder-artist page",
    "song_results": "Cover art + title + artist + album + year + duration + status (In Library / Queued / Download button)",
    "album_results": "Cover art + title + artist + year + track count + type + In Library badge. Click → finder-release page",
    "youtube_results": "Preview button (▶ plays audio snippet) + thumbnail + title + channel + duration + download"
  },
  "Import_tab": {
    "input": "Paste YouTube playlist URL",
    "action": "Import → yt-dlp extracts track list → creates watched playlist + download jobs for missing tracks",
    "watched_list": "Auto-refresh toggle + refresh button + delete button per playlist"
  },
  "Downloads_tab": {
    "polling": "Every 3 seconds",
    "display": "Job cards with status badges (queued/searching/downloading/tagging/completed/failed)",
    "actions": ["Retry failed", "Delete job", "Download completed file", "Clear history", "Retry All Failed"],
    "badge": "Active count shown as badge on Ripper tab"
  },
  "finder-artist_page": {
    "sub_tabs": ["Tracklist", "Albums"],
    "tracklist": "All unique tracks by artist from MusicBrainz + filter input + Download All button",
    "albums": "Album cards → click → finder-release page",
    "download_all": "Queues all non-library tracks via queueAddBatch"
  },
  "finder-release_page": {
    "hero": "Album cover from Cover Art Archive + title + artist",
    "action": "Download All Tracks button (queueAddBatch)",
    "list": "Track number + title + artist + duration + In Library/Queued/Download per track"
  }
}
```

---

## SETTINGS PAGE

```json
{
  "locked": true,
  "password": "pancake (frontend-only check)",
  "sections": {
    "Library": {
      "actions": ["Rescan Library button"]
    },
    "Now Playing": {
      "waveform_style_select": ["Rounded Bars", "Mirrored", "Layered", "Layered Mirror", "Squiggle"],
      "preview_canvas": "Live preview of selected waveform style",
      "save_button": "Saves waveform_style to settings"
    },
    "Ripper Settings": {
      "audio_format": ["FLAC (lossless)", "MP3", "Opus", "M4A/AAC", "Original (no conversion)"],
      "mp3_quality": ["V2 ~192kbps", "V0 ~245kbps", "320k/256k/192k/128k CBR"],
      "opus_bitrate": ["320k/256k/192k/128k/96k"],
      "max_concurrent": ["1/2/3/5"],
      "album_subdirectory": "Text input (default 'Albums')",
      "min_bitrate": "Text input (default 0 = no minimum)",
      "toggles": ["Convert to FLAC", "Organise by Artist"],
      "save_button": "Saves all ripper settings"
    },
    "Downloadable Tracks": {
      "toggle": "Enable Downloads (global)",
      "manage_button": "Opens per-track download toggle list (searchable)"
    },
    "Bulk Import": {
      "textarea": "Paste 'Artist - Title' lines (one per line)",
      "button": "Import & Download All → creates download jobs"
    },
    "MusicBrainz Metadata": {
      "status": "Pending/Approved/Rejected counts",
      "actions": ["Scan Metadata", "Review Pending (if any)", "Match History"]
    },
    "About": {
      "text": "MusicApp - Personal music library with MusicBrainz integration"
    }
  }
}
```

---

## ADMIN PAGE

```json
{
  "file": "admin.html",
  "access": "Cookie-gated (admin_auth=1), login with hardcoded passcode 'countstuff2026'",
  "features": {
    "file_browser": "Navigate music directory, breadcrumb path",
    "upload": "Drag-and-drop or browse, 500MB max, audio files only",
    "delete_files": "Delete button per file",
    "create_folders": "Create folder button",
    "rescan": "Rescan Library button (triggers same as settings)"
  }
}
```

---

## BACKEND: API ROUTES

```html
<table>
<tr><th>Route</th><th>Method</th><th>Handler</th><th>Auth</th></tr>
<tr><td colspan="4"><strong>Library</strong></td></tr>
<tr><td>/api/library</td><td>GET</td><td>libraryHandler</td><td>Public</td></tr>
<tr><td>/api/stats</td><td>GET</td><td>statsHandler</td><td>Public</td></tr>
<tr><td>/api/stream/{id}</td><td>GET</td><td>streamHandler (Range support)</td><td>Public</td></tr>
<tr><td>/api/cover/{albumID}</td><td>GET</td><td>coverHandler</td><td>Public</td></tr>
<tr><td>/api/artist-art/{name}</td><td>GET</td><td>artistArtHandler</td><td>Public</td></tr>
<tr><td>/api/artist-art-fetch/{name}</td><td>POST</td><td>artistArtFetchHandler</td><td>Public</td></tr>
<tr><td>/api/scan</td><td>POST</td><td>scanHandler</td><td>Public</td></tr>
<tr><td>/api/waveform/{id}</td><td>GET</td><td>waveformHandler</td><td>Public</td></tr>
<tr><td>/api/track-duration/{id}</td><td>POST</td><td>trackDurationHandler</td><td>Public</td></tr>
<tr><td>/api/download/{id}</td><td>GET</td><td>downloadHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Playlists</strong></td></tr>
<tr><td>/api/playlists</td><td>GET/POST</td><td>playlistsHandler</td><td>Public</td></tr>
<tr><td>/api/playlists/{id}</td><td>PUT/DELETE</td><td>playlistHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Favorites & Recent</strong></td></tr>
<tr><td>/api/favorites</td><td>GET</td><td>favoritesHandler</td><td>Public</td></tr>
<tr><td>/api/favorites/{trackID}</td><td>POST</td><td>favoriteToggleHandler</td><td>Public</td></tr>
<tr><td>/api/recent</td><td>GET</td><td>recentHandler</td><td>Public</td></tr>
<tr><td>/api/recent/{trackID}</td><td>POST</td><td>recentAddHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Download Queue</strong></td></tr>
<tr><td>/api/queue</td><td>GET</td><td>downloadQueueHandler</td><td>Public</td></tr>
<tr><td>/api/queue/add</td><td>POST</td><td>downloadQueueAddHandler</td><td>Public</td></tr>
<tr><td>/api/queue/add-batch</td><td>POST</td><td>downloadQueueAddBatchHandler</td><td>Public</td></tr>
<tr><td>/api/queue/counts</td><td>GET</td><td>queueCountsHandler</td><td>Public</td></tr>
<tr><td>/api/queue/clear-completed</td><td>POST</td><td>queueClearCompletedHandler</td><td>Public</td></tr>
<tr><td>/api/queue/{id}/retry</td><td>POST</td><td>downloadJobRetryHandler</td><td>Public</td></tr>
<tr><td>/api/queue/{id}/delete</td><td>POST</td><td>downloadJobDeleteHandler</td><td>Public</td></tr>
<tr><td>/api/download-job/{id}</td><td>GET</td><td>downloadJobFileHandler</td><td>Public</td></tr>
<tr><td>/api/bulk-import</td><td>POST</td><td>bulkImportHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Finder / MusicBrainz</strong></td></tr>
<tr><td>/api/finder/search</td><td>GET</td><td>finderSearchHandler</td><td>Public</td></tr>
<tr><td>/api/finder/artist/{mbid}/releases</td><td>GET</td><td>finderArtistReleasesHandler</td><td>Public</td></tr>
<tr><td>/api/finder/artist/{mbid}/tracks</td><td>GET</td><td>finderArtistTracksHandler</td><td>Public</td></tr>
<tr><td>/api/finder/release/{mbid}/tracks</td><td>GET</td><td>finderReleaseTracksHandler</td><td>Public</td></tr>
<tr><td>/api/finder/cover/{mbid}</td><td>GET</td><td>finderCoverHandler</td><td>Public</td></tr>
<tr><td>/api/finder/youtube</td><td>GET</td><td>youtubeSearchHandler</td><td>Public</td></tr>
<tr><td>/api/preview/{videoID}</td><td>GET</td><td>previewAudioHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Metadata</strong></td></tr>
<tr><td>/api/metadata/scan</td><td>POST</td><td>metadataScanHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/scan-progress</td><td>GET</td><td>metadataScanProgressHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/pending</td><td>GET</td><td>metadataPendingHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/all</td><td>GET</td><td>metadataAllHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/approve/{id}</td><td>POST</td><td>metadataApproveHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/reject/{id}</td><td>POST</td><td>metadataRejectHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/approve-all</td><td>POST</td><td>metadataApproveAllHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/clear</td><td>POST</td><td>metadataClearHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/counts</td><td>GET</td><td>metadataCountsHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/rescan/{id}</td><td>POST</td><td>metadataRescanHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/rescan-sync/{id}</td><td>POST</td><td>metadataRescanSyncHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/update-track/{id}</td><td>POST</td><td>metadataUpdateTrackHandler</td><td>Public</td></tr>
<tr><td>/api/metadata/undo/{id}</td><td>POST</td><td>metadataUndoHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Watched Playlists</strong></td></tr>
<tr><td>/api/watch</td><td>GET/POST</td><td>watchedPlaylistsHandler</td><td>Public</td></tr>
<tr><td>/api/watch/{id}</td><td>DELETE</td><td>watchedPlaylistsHandler</td><td>Public</td></tr>
<tr><td>/api/watch/{id}/refresh</td><td>POST</td><td>watchedPlaylistsHandler</td><td>Public</td></tr>
<tr><td>/api/watch/{id}/toggle</td><td>PUT</td><td>watchedPlaylistsHandler</td><td>Public</td></tr>
<tr><td>/api/playlist-import</td><td>POST</td><td>playlistImportHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Sharing</strong></td></tr>
<tr><td>/api/shared-queue</td><td>POST</td><td>sharedQueueCreateHandler</td><td>Public</td></tr>
<tr><td>/api/shared-queue/{id}</td><td>GET</td><td>sharedQueueGetHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Settings</strong></td></tr>
<tr><td>/api/settings</td><td>GET/POST</td><td>settingsGetHandler / settingsSetHandler</td><td>Public</td></tr>

<tr><td colspan="4"><strong>Admin (cookie-gated)</strong></td></tr>
<tr><td>/admin</td><td>GET</td><td>adminHandler</td><td>Cookie</td></tr>
<tr><td>/api/admin-login</td><td>POST</td><td>adminLoginHandler</td><td>Public</td></tr>
<tr><td>/api/files</td><td>GET</td><td>fileListHandler</td><td>Admin</td></tr>
<tr><td>/api/upload</td><td>POST</td><td>uploadHandler</td><td>Admin</td></tr>
<tr><td>/api/delete</td><td>DELETE</td><td>deleteFileHandler</td><td>Admin</td></tr>
<tr><td>/api/folders</td><td>POST</td><td>createFolderHandler</td><td>Admin</td></tr>
<tr><td>/api/admin/downloads</td><td>GET</td><td>downloadsListHandler</td><td>Admin</td></tr>
<tr><td>/api/admin/download-toggle/{id}</td><td>POST</td><td>downloadToggleHandler</td><td>Admin</td></tr>
<tr><td>/api/admin/downloads-enable-all</td><td>POST</td><td>downloadsEnableAllHandler</td><td>Admin</td></tr>
</table>
```

---

## DATA MODELS

```json
{
  "Track": {
    "fields": {
      "id": "string — SHA-256 of file path, truncated to 12 hex chars",
      "title": "string",
      "artist": "string",
      "album": "string",
      "albumArtist": "string",
      "albumID": "string — SHA-256 of lowercase 'artist|album'",
      "trackNumber": "int",
      "year": "int",
      "genre": "string",
      "duration": "int (seconds)",
      "filePath": "string — prefix:path scheme (e.g., 'media:song.flac')",
      "hasCover": "bool",
      "modTime": "int64 (unix timestamp)",
      "mbid": "string (MusicBrainz ID, optional)",
      "hasMetadata": "bool — true if tags were successfully read",
      "downloadEnabled": "bool"
    }
  },
  "Album": {
    "fields": {
      "id": "string",
      "name": "string",
      "artist": "string",
      "trackCount": "int",
      "year": "int",
      "hasCover": "bool"
    }
  },
  "Artist": {
    "fields": {
      "name": "string",
      "albumCount": "int",
      "trackCount": "int"
    },
    "note": "Computed at request time from tracks/albums, not persisted"
  },
  "Playlist": {
    "fields": {
      "id": "string (UUID)",
      "name": "string",
      "trackIds": "string[]",
      "createdAt": "string (RFC3339)"
    }
  },
  "DownloadJob": {
    "fields": {
      "id": "string (8-char UUID)",
      "query": "string",
      "artist": "string",
      "title": "string",
      "album": "string",
      "albumMBID": "string",
      "trackNumber": "int",
      "trackTotal": "int",
      "status": "'queued' | 'searching' | 'downloading' | 'tagging' | 'completed' | 'failed'",
      "error": "string",
      "source": "string",
      "audioQuality": "string (e.g., 'FLAC 44.1kHz')",
      "filePath": "string",
      "progressStage": "string",
      "overrideDir": "string",
      "videoID": "string (YouTube video ID, if known)",
      "playlistID": "string (auto-add to playlist after download)",
      "createdAt": "string",
      "completedAt": "string"
    }
  },
  "MetadataMatch": {
    "fields": {
      "id": "string (UUID)",
      "trackId": "string",
      "trackTitle": "string",
      "trackArtist": "string",
      "mbTitle": "string",
      "mbArtist": "string",
      "mbAlbum": "string",
      "mbAlbumId": "string",
      "mbScore": "float (0.0-1.0)",
      "status": "'pending' | 'approved' | 'rejected'"
    }
  },
  "WatchedPlaylist": {
    "fields": {
      "id": "string",
      "url": "string (YouTube playlist URL)",
      "name": "string",
      "trackCount": "int",
      "lastRefresh": "string",
      "watching": "bool"
    }
  }
}
```

---

## DATABASE SCHEMA

```sql
-- 13 tables total in data/music.db

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '', artist TEXT DEFAULT '', album TEXT DEFAULT '',
  album_artist TEXT DEFAULT '', album_id TEXT DEFAULT '',
  track_number INTEGER DEFAULT 0, year INTEGER DEFAULT 0,
  genre TEXT DEFAULT '', duration INTEGER DEFAULT 0,
  file_path TEXT NOT NULL, has_cover INTEGER DEFAULT 0,
  mod_time INTEGER DEFAULT 0, has_metadata INTEGER DEFAULT 0,
  orig_title TEXT DEFAULT '',       -- backup for metadata undo
  orig_artist TEXT DEFAULT '',      -- backup for metadata undo
  orig_album TEXT DEFAULT '',       -- backup for metadata undo
  orig_album_artist TEXT DEFAULT '',-- backup for metadata undo
  orig_album_id TEXT DEFAULT ''     -- backup for metadata undo
);

CREATE TABLE albums (
  id TEXT PRIMARY KEY, name TEXT DEFAULT '',
  artist TEXT DEFAULT '', track_count INTEGER DEFAULT 0,
  year INTEGER DEFAULT 0, has_cover INTEGER DEFAULT 0
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL, track_id TEXT NOT NULL,
  position INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE favorites (
  track_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recent (
  track_id TEXT PRIMARY KEY, position INTEGER NOT NULL
);

CREATE TABLE metadata_matches (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL,
  track_title TEXT NOT NULL, track_artist TEXT NOT NULL,
  mb_title TEXT NOT NULL, mb_artist TEXT NOT NULL,
  mb_album TEXT NOT NULL, mb_album_id TEXT NOT NULL,
  mb_score REAL NOT NULL, status TEXT DEFAULT 'pending',
  UNIQUE(track_id, mb_album_id)
);

CREATE TABLE download_jobs (
  id TEXT PRIMARY KEY, query TEXT DEFAULT '',
  artist TEXT DEFAULT '', title TEXT DEFAULT '',
  album TEXT DEFAULT '', album_mbid TEXT DEFAULT '',
  track_number INTEGER DEFAULT 0, track_total INTEGER DEFAULT 0,
  status TEXT DEFAULT 'queued', error TEXT DEFAULT '',
  source TEXT DEFAULT '', audio_quality TEXT DEFAULT '',
  file_path TEXT DEFAULT '', file_deleted INTEGER DEFAULT 0,
  progress_stage TEXT DEFAULT '', override_dir TEXT DEFAULT '',
  search_query TEXT DEFAULT '', convert_to_flac INTEGER DEFAULT 1,
  playlist_id TEXT DEFAULT '', video_id TEXT DEFAULT '',
  created_at TEXT NOT NULL, completed_at TEXT DEFAULT ''
);

CREATE TABLE downloads (
  track_id TEXT PRIMARY KEY, disabled INTEGER DEFAULT 0
);

CREATE TABLE shared_queues (
  id TEXT PRIMARY KEY, track_ids TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY, value TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

CREATE TABLE watched_playlists (
  id TEXT PRIMARY KEY, url TEXT NOT NULL,
  name TEXT DEFAULT '', track_count INTEGER DEFAULT 0,
  last_refresh TEXT DEFAULT '', watching INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE watched_playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL, video_id TEXT DEFAULT '',
  artist TEXT DEFAULT '', title TEXT DEFAULT '',
  job_id TEXT, status TEXT DEFAULT 'pending',
  FOREIGN KEY (playlist_id) REFERENCES watched_playlists(id)
);
```

---

## KEY LIFECYCLES

### Download Queue Lifecycle

```
1. User clicks "Download" on a finder result
   → POST /api/queue/add {artist, title, album, albumMbid, trackNumber, trackTotal}
   → createDownloadJob() — checks for duplicates in library, creates job with status="queued"
   → Triggers processDownloadQueue() in goroutine

2. processDownloadQueue()
   → Semaphore limits concurrency to 3 (configurable)
   → Picks up queued jobs from DB

3. processSingleDownload(job)
   a. status → "searching"
      → searchYouTube() via yt-dlp --dump-json ytsearch10:{query}
      → Scores results: channel match +60, title match +50, penalties for karaoke/remix/live
   b. Determine output path (Artist/Album/ structure if organise-by-artist enabled)
   c. status → "downloading"
      → yt-dlp extracts audio with configured format/quality
      → 10 minute timeout per download
   d. Validate audio integrity (ffprobe: has audio stream, duration > 0)
   e. Check minimum bitrate (ffprobe)
   f. Tag file via ffmpeg (artist, title, album, track number)
   g. Probe final quality (codec + bitrate/sample rate)
   h. status → "completed" (or "failed" at any step with error message)
   i. Post-completion: rescan music dir, add to playlist if playlistID set

4. Watchdog (every 2 minutes)
   → Kills jobs running > 11 minutes
   → Starts queue processing if queued jobs exist

5. Recovery at startup
   → recoverStalledDownloads() resets searching/downloading/tagging → queued
```

### Metadata Scan Lifecycle

```
1. User clicks "Scan Metadata" in Settings
   → POST /api/metadata/scan
   → scanMetadataForTracks() in goroutine

2. scanMetadataForTracks()
   → Acquires metaScanLock (one scan at a time)
   → Collects tracks: missing tags AND no existing matches
   → Skips tracks with has_metadata=1 (already Lidarr-managed)
   → Falls back to filename for search terms if tags empty
   → 2 worker goroutines via channel
   → Each worker:
      - mbSearchRecordings(artist, title, 3)
      - scoreMatch() for each candidate
      - If score >= 0.5: insert as pending match to DB
      - 600ms delay between requests (rate limiting)
   → Auto-approves all pending with score >= 0.8
   → applyApprovedMatches()

3. Manual Review
   → GET /api/metadata/pending → grouped by track
   → UI shows: Your Track → [candidate list with scores]
   → Approve / Reject per candidate
   → POST /api/metadata/approve/{id} → applies best match, deletes competing matches

4. applyApprovedMatches()
   → For each approved match:
      - Pick best-scoring match per track
      - Update track artist/title/album in memory
      - Persist to DB (with orig_* backup for undo)
      - Handle cover art file renaming (albumID may change)
      - Rebuild albums map
   → Async: fetch cover art from Cover Art Archive

5. Undo
   → POST /api/metadata/undo/{id}
   → Reverts track to orig_* values, resets match to pending

6. Single Track Rescan
   → "Rescan Metadata" from track context menu
   → POST /api/metadata/rescan-sync/{id}
   → Returns candidates directly (no DB storage), user picks one
```

### Watched Playlist Lifecycle

```
1. User imports YouTube playlist URL in Ripper > Import tab
   → POST /api/playlist-import {url}
   → extractYouTubePlaylistTracks() via yt-dlp --flat-playlist --dump-json
   → Creates WatchedPlaylist in DB
   → For each track:
      - If already in library: add to matching library playlist
      - If not: create download job + record in watched_playlist_tracks
   → Creates/updates library playlist with same name

2. Auto-refresh (every hour via startWatchScheduler)
   → refreshAllWatchedPlaylists()
   → For each playlist with watching=true:
      - Re-extract YouTube track list
      - Compare against existing tracked tracks
      - New tracks: check library → add to playlist or create download job
      - 30s delay between playlist refreshes

3. Manual refresh
   → POST /api/watch/{id}/refresh

4. Toggle watching
   → PUT /api/watch/{id}/toggle {watching: bool}

5. Delete
   → DELETE /api/watch/{id}
```

### File Scanning Lifecycle

```
1. filepath.Walk(dir) → collect audio files (.mp3, .flac, .m4a, .aac, .ogg, .wav, .opus, .wma)
2. For each file:
   → Generate relative path, add prefix for media dirs
   → generateID(path) → SHA-256 truncated to 12 hex chars
   → tag.ReadFrom(file) using github.com/dhowden/tag
   → Extract: Title, Artist, Album, AlbumArtist, Year, Genre, TrackNumber
   → Fallbacks: filename → title, folder name → artist
   → AlbumID = generateAlbumID(AlbumArtist, Album)
   → Extract embedded cover art → save to images/{albumID}.jpg
3. Persist: dbUpsertTrack, dbUpsertAlbum
4. Cleanup: remove DB entries for deleted files (primary dir only)
5. Update in-memory maps under mutex

Filesystem Watcher:
→ Polls every 30 seconds
→ Compares audio file counts per directory
→ If changed: rescan that directory, extract covers, increment libraryVersion
```

---

## CACHING STRATEGY

```json
{
  "cover_art": {
    "tiers": ["In-memory coverCache map", "Disk: images/{albumID}.jpg", "Generate SVG placeholder with hash-based gradient color"],
    "headers": "Cache-Control: public, max-age=86400"
  },
  "artist_images": {
    "tiers": ["In-memory artistArtCache map", "Disk: images/artists/{key}.jpg", "First album cover", "SVG placeholder"],
    "source": "Deezer API (free, no key)"
  },
  "waveforms": {
    "tiers": ["Disk: images/waveforms/{trackID}.json", "Generate via ffmpeg (8kHz mono PCM → 300 peak buckets)"],
    "initial": "Flat bars (all same height) shown immediately, real peaks loaded async"
  },
  "library_data": {
    "tiers": ["In-memory maps (tracks, albums)", "SQLite database (data/music.db)"],
    "pattern": "Loaded at startup, updated on scan, protected by sync.RWMutex"
  }
}
```

---

## SECURITY MODEL

```json
{
  "admin_page": {
    "protection": "Cookie-based (admin_auth=1)",
    "passcode": "Hardcoded: 'countstuff2026'",
    "routes_protected": ["/api/files", "/api/upload", "/api/delete", "/api/folders", "/api/admin/downloads", "/api/admin/download-toggle/*", "/api/admin/downloads-enable-all"]
  },
  "settings_page": {
    "protection": "Frontend-only password check",
    "password": "Hardcoded in JS: 'pancake'",
    "note": "Settings API endpoints have NO backend auth — anyone can POST /api/settings"
  },
  "api_routes": {
    "note": "All non-admin API routes are public (no auth required)"
  },
  "spa_handler": {
    "feature": "Injects OpenGraph meta tags for share URLs (?play, ?album, ?artist, ?playlist)"
  }
}
```

---

## MUTEX / CONCURRENCY MAP

```json
{
  "mu (sync.RWMutex)": {
    "protects": ["tracks map", "albums map"],
    "readers": "libraryHandler, streamHandler, coverHandler, artistArtHandler, statsHandler, etc.",
    "writers": "scanHandler, metadataApply, trackDuration update"
  },
  "coverMu (sync.RWMutex)": {
    "protects": "coverCache map"
  },
  "artistArtMu (sync.RWMutex)": {
    "protects": "artistArtCache map"
  },
  "downloadMu (sync.Mutex)": {
    "protects": ["downloadActive count", "activeJobs map", "activeJobTime map"]
  },
  "downloadSem (chan struct{}, cap 3)": {
    "purpose": "Limits concurrent yt-dlp downloads to 3 (configurable)"
  },
  "metaScanLock (sync.Mutex)": {
    "purpose": "Prevents concurrent metadata scans"
  },
  "watcherMu (sync.Mutex)": {
    "protects": "lastFileCounts map"
  },
  "watchMu (sync.Mutex)": {
    "purpose": "Prevents concurrent watched playlist refreshes"
  },
  "libraryVersion (atomic.Int64)": {
    "purpose": "Incremented on library changes, can be polled by frontend"
  }
}
```

---

## ID GENERATION

```json
{
  "generateID(input)": "SHA-256 hash → first 12 hex chars (48 bits). Used for track IDs and album IDs",
  "generateUUID()": "Random UUID v4 from crypto/rand. Used for playlists, metadata matches, download jobs",
  "generateAlbumID(artist, album)": "generateID(lowercase(artist + '|' + album)). Deterministic — same artist+album always same ID",
  "shared_queue_id": "8-char UUID from crypto/rand"
}
```

---

## SETTINGS (DEFAULTS)

```json
{
  "download_format": "flac",
  "download_concurrent": "3",
  "download_organise_by_artist": "true",
  "download_album_subdir": "Albums",
  "download_convert_to_flac": "true",
  "download_min_bitrate": "0",
  "downloads_enabled": "true",
  "waveform_style": "rounded",
  "mp3_bitrate": "v2",
  "opus_bitrate": "320k"
}
```

---

## SHARING & DEEP LINKS

```json
{
  "share_track": "?play=TRACK_ID → loads track, shows Now Playing, doesn't auto-play",
  "share_queue": "?q=QUEUE_ID → loads shared queue, auto-plays, shows Now Playing",
  "share_artist": "?artist=NAME → navigates to artist page",
  "share_album": "?album=ID → navigates to album page",
  "share_playlist": "?playlist=ID → plays playlist if has tracks, else navigates to playlist page",
  "opengraph": "spaHandler injects og:title, og:image, og:url meta tags for all share URL types",
  "shared_queue_creation": "POST /api/shared-queue {trackIds: [...]} → returns {id: '8char'}",
  "share_methods": ["Web Share API (mobile)", "Clipboard copy (desktop)"]
}
```

---

## SMART PLAY LOGIC

```json
{
  "_smartPlay(track)": {
    "if_track_in_queue": "Play from current queue position (playInQueue)",
    "else_if_viewTrackList_has_multiple": "Play track in context of current view's track list",
    "else": "Play track solo (no queue context)"
  },
  "_getViewSource()": {
    "maps_current_view_to_source": {
      "album": "{type: 'album', name: album.name, id: albumId}",
      "artist": "{type: 'artist', name: artistName}",
      "playlist": "{type: 'playlist', name: playlist.name, id: playlistId}",
      "favorites": "{type: 'favorites', name: 'Favorites'}",
      "all-music": "{type: 'all', name: 'All Music'}",
      "search": "{type: 'search', name: 'Search Results'}"
    },
    "source_used_for": "Header text in Now Playing, shared queue name"
  }
}
```

---

## ALBUM ART COLOR EXTRACTION

```json
{
  "method": "Draw cover art to 10x10 hidden canvas → average all pixel RGB values",
  "used_for": {
    "now_playing_bg": "Glow behind artwork with album color at 45% opacity",
    "mini_player_bg": "Gradient background from album color",
    "waveform_color": "Played bars use vibrant HSL variant of album color",
    "theme_color": "Meta theme-color tag set to darkened album color",
    "mini_progress": "Progress bar color matches album color"
  },
  "hsl_transform": "S+35, L clamped 45-65% for vibrancy"
}
```

---

## DEPLOYMENT

```json
{
  "ci": "GitLab CI (.gitlab-ci.yml)",
  "docker": {
    "build": "go build -mod=vendor",
    "runtime": "Alpine with python3, ffmpeg, yt-dlp",
    "mounts": {
      "/app/data": "Database",
      "/music": "Primary library",
      "/media-music": "Secondary library (optional)"
    },
    "port": "8081 internal → 8298 external"
  }
}
```
