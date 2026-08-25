package main

import (
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"log"
	"musicapp/internal/auth"
	"musicapp/internal/downloads"
	"musicapp/internal/handlers"
	"musicapp/internal/models"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/review"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
	"musicapp/internal/watched"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"
)

func main() {
	// Load .env first so every env-based knob (MUSIC_DIR, PORT, ...) sees it.
	// Real env vars still win; missing file is a silent no-op.
	loadDotEnv(".env")

	// Capture logs into a ring buffer for the /api/admin/logs endpoint.
	logBuf := store.InitLogCapture()
	log.SetOutput(io.MultiWriter(os.Stderr, logBuf))

	dirFlag := flag.String("dir", "", "Path to music directory")
	flag.Parse()

	store.MusicDir = *dirFlag
	if store.MusicDir == "" {
		store.MusicDir = os.Getenv("MUSIC_DIR")
	}
	if store.MusicDir == "" {
		exe, err := os.Executable()
		if err == nil {
			store.MusicDir = filepath.Join(filepath.Dir(exe), "music")
		} else {
			store.MusicDir = "music"
		}
	}
	os.MkdirAll(store.MusicDir, 0755)

	absDir, err := filepath.Abs(store.MusicDir)
	if err != nil {
		log.Fatalf("Could not resolve music directory path: %v", err)
	}
	store.MusicDir = absDir

	info, err := os.Stat(store.MusicDir)
	if err != nil || !info.IsDir() {
		log.Fatalf("Music directory does not exist: %s", store.MusicDir)
	}

	// Initialize musicDirs with the primary directory
	store.MusicDirs = map[string]string{"": store.MusicDir}

	// Check for additional media music directory
	mediaDir := os.Getenv("MEDIA_MUSIC_DIR")
	if mediaDir != "" {
		absMedia, err := filepath.Abs(mediaDir)
		if err != nil {
			log.Fatalf("Could not resolve media music directory path: %v", err)
		}
		mediaInfo, err := os.Stat(absMedia)
		if err != nil || !mediaInfo.IsDir() {
			log.Fatalf("Media music directory does not exist: %s", absMedia)
		}
		store.MusicDirs["media"] = absMedia
		log.Printf("Media music directory: %s", absMedia)
	}

	store.ReplaceLibrary(make(map[string]*models.Track), make(map[string]*models.Album))
	store.CoverCache = make(map[string][]byte)
	store.CustomCovers = make(map[string]bool)

	store.InitDB(filepath.Join("data", "music.db"))
	_ = os.Setenv("MUSICAPP_MB_RATE_FILE", store.DBPath+".mb-rate")
	store.LoadCustomCovers()
	downloads.InitDownloadTables()
	watched.InitWatchedTables()
	review.InitReviewTables()

	wireCrossPackageHooks()

	// Try loading from DB first
	dbTracks := store.DbLoadTracks()
	dbAlbums := store.DbLoadAlbums()
	if len(dbTracks) > 0 {
		store.ReplaceLibrary(dbTracks, dbAlbums)
		log.Printf("Loaded %d tracks and %d albums from database", store.TrackCount(), store.AlbumCount())
	}

	// Covers and artist art are lazy-loaded from disk on first request

	ytdlp := downloads.FindYtDlp()
	ffmpeg := downloads.FindFfmpeg()
	if ytdlp != "" {
		log.Printf("yt-dlp found: %s", ytdlp)
	} else {
		log.Printf("WARNING: yt-dlp not found — downloads will fail. Install: pip install yt-dlp")
	}
	if ffmpeg != "" {
		log.Printf("ffmpeg found: %s", ffmpeg)
	} else {
		log.Printf("WARNING: ffmpeg not found — audio conversion will fail. Install: apt install ffmpeg")
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[startup] panic recovered: %v\n%s", r, debug.Stack())
			}
		}()

		// Check if file counts match DB — skip full scan if nothing changed.
		// Done here (in the goroutine) rather than in main() so startup is not
		// blocked by a full tree walk on every boot; the DB-loaded library is
		// already available to serve requests immediately.
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
					store.View(func(l *store.Library) {
						for _, t := range l.Tracks {
							if strings.HasPrefix(t.FilePath, prefix+":") {
								mediaDBCount++
							}
						}
					})
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
			log.Printf("Primary scan complete: %d files found, %d tracks loaded", stats.Scanned, store.TrackCount())

			for prefix, dir := range store.MusicDirs {
				if prefix == "" {
					continue
				}
				log.Printf("Scanning media directory [%s]: %s", prefix, dir)
				mediaStats := scanner.ScanMusicDirWithPrefix(dir, prefix)
				log.Printf("Media scan [%s] complete: %d files found, %d tracks loaded", prefix, mediaStats.Scanned, store.TrackCount())
			}

		store.LibraryVersion.Add(1)
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
		scanner.PruneSharedDirTracks()
		scanner.PruneTruncatedTracks()
		watched.SyncWatchedPlaylistsToLibrary()
		downloads.RecoverStalledDownloads()
		review.SeedMissingReviewTracks()
		review.CleanupOldReviewFlags()
		review.CleanupOrphanedReviews()
		store.DbCleanupFavorites()
		store.DbCleanupRecent()
		store.DbCleanupPlaylistTracks()

		// Auto-connect Soulseek: if credentials are saved, ensure the share
		// folder is seeded and slsk is enabled. No login test needed — that
		// only matters for first-time setup via the Connect button.
		if u := store.GetSetting("slsk_username", ""); u != "" {
			if p := store.GetSetting("slsk_password", ""); p != "" {
				shareDir := store.SlskShareDir()
				os.MkdirAll(shareDir, 0755)
				if n, err := downloads.SeedSlskShare(shareDir); err != nil {
					log.Printf("[startup] soulseek share seed error: %v", err)
				} else if n > 0 {
					log.Printf("[startup] soulseek: seeded %d files into share folder", n)
				}
				store.SetSetting("slsk_enabled", "true")
				log.Printf("[startup] soulseek: auto-connected as %s", u)
			}
		}

		// Last: warm the AAC cache for pre-existing tracks. Must run after the
		// scan/DB load above — a concurrent fire sees an empty library and
		// burns the once-per-library marker on nothing.
		store.SafeGo("transcode-backfill", func() {
			store.WorkerStart("transcode-backfill")
			defer store.WorkerDone("transcode-backfill", nil)
			handlers.BackfillTranscodeCache()
		})
	}()

	// Register all background workers with the registry so the settings
	// panel can display status and (where possible) trigger them on demand.
	store.RegisterWorker("scanner", "Scans music directories for new/changed files", "Every 30s (configurable)", func() {
		scanner.ForceRescan()
	})
	store.RegisterWorker("cleanup", "Prunes missing/shared/truncated tracks + dedup", "Every 5 min", func() {
		scanner.PruneMissingTracks()
		scanner.PruneSharedDirTracks()
		scanner.PruneTruncatedTracks()
		store.DedupTracks()
	})
	store.RegisterWorker("download-watchdog", "Kills stalled downloads, resets orphaned jobs", "Every 2 min", nil)
	store.RegisterWorker("review", "Flags tracks with missing metadata, duplicates, anomalies", "Every 24h (configurable)", func() {
		review.WakeReviewWorker()
	})
	store.RegisterWorker("watched-playlists", "Syncs YouTube watched playlists to library", "Every 1 hour (off unless watched_enabled=true)", func() {
		if !store.GetSettingBool("watched_enabled", false) {
			return
		}
		store.SafeGo("watched-refresh-all", func() { watched.RefreshAllWatchedPlaylists() })
	})
	store.RegisterWorker("cover-fetch", "Fetches missing album covers from MusicBrainz", "Startup + every 24h", func() {
		musicbrainz.FetchMissingCovers()
	})
	store.RegisterWorker("artist-art-fetch", "Fetches missing artist art from Deezer", "Startup + every 24h", func() {
		musicbrainz.FetchMissingArtistArt()
	})
	store.RegisterWorker("transcode-prune", "Purges stale/oversized transcode cache entries", "Every 30 min", func() {
		transcode.PruneCache()
	})
	store.RegisterWorker("transcode-backfill", "Warms AAC streaming cache for pre-existing tracks (runs once)", "Startup (once per library)", func() {
		handlers.BackfillTranscodeCache()
	})

	runWorker := func(name string, body func()) {
		store.SafeGo(name, func() {
			store.WorkerStart(name)
			defer store.WorkerDone(name, nil)
			body()
		})
	}
	runWorker("cover-fetch", func() { musicbrainz.FetchMissingCovers() })
	runWorker("artist-art-fetch", func() { musicbrainz.FetchMissingArtistArt() })
	go scanner.StartWatcher()
	go watched.StartWatchScheduler()
	go downloads.DownloadWatchdog()
	go review.StartReviewScheduler()

	// Daily art refresh: the startup fetch is one-shot, and a transient
	// failure at boot (or art enabled later) previously left placeholders
	// until the next restart or manual trigger. Both fetchers have their own
	// overlap guards, so an early run just coalesces.
	go func() {
		t := time.NewTicker(24 * time.Hour)
		for range t.C {
			if store.GetSettingBool("cover_fetch_enabled", true) {
				runWorker("cover-fetch", func() { musicbrainz.FetchMissingCovers() })
			}
			if store.GetSettingBool("artist_art_fetch_enabled", true) {
				runWorker("artist-art-fetch", func() { musicbrainz.FetchMissingArtistArt() })
			}
		}
	}()

	// Cleanup owns its schedule — it previously piggybacked on the watcher
	// tick, so disabling the watcher silently stopped cleanup too.
	go func() {
		t := time.NewTicker(5 * time.Minute)
		for range t.C {
			store.SafeGo("cleanup-tick", func() {
				store.WorkerStart("cleanup")
				defer store.WorkerDone("cleanup", nil)
				scanner.PruneMissingTracks()
				scanner.PruneSharedDirTracks()
				scanner.PruneTruncatedTracks()
				store.DedupTracks()
			})
		}
	}()

	// Transcode cache: purge stale/oversized entries every 30 minutes. The
	// cache lives in data/transcode/ and is keyed by track ID + source mtime,
	// so re-downloaded files invalidate their entry automatically.
	go func() {
		t := time.NewTicker(30 * time.Minute)
		for range t.C {
			store.SafeGo("transcode-prune", func() { transcode.PruneCache() })
		}
	}()

	mux := http.NewServeMux()

	registerRoutes(mux)

	// Dev-only waveform playground (no auth; serves a static page).
	mux.HandleFunc("/waveform-test", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "waveform-test.html")
	})


	var handler http.Handler = mux
	handler = auth.SessionLoad(handler)
	handler = loggingMiddleware(recoveryMiddleware(handler))
	handler = gzipMiddleware(handler)

	mux.HandleFunc("/robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("User-agent: *\nDisallow: /\n"))
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		handlers.SpaHandler(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	addr := ":" + port
	url := fmt.Sprintf("http://localhost%s", addr)

	log.Printf("Starting server on %s", addr)
	log.Printf("Open %s in your browser", url)

	store.SafeGo("open-browser", func() {
		time.Sleep(500 * time.Millisecond)
		handlers.OpenBrowser(url)
	})

	// Header-read and idle timeouts shed dead/hung clients. Deliberately no
	// WriteTimeout: synchronous transcodes can legitimately run for minutes
	// and long streams must not be cut off mid-file.
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

// wireCrossPackageHooks is THE composition point for cross-package seams.
// These function vars exist only to break import cycles (scanner/review/
// downloads cannot import each other or the handlers package); they are nil
// until wired here and MUST be wired before the server starts serving.
// Library cache invalidation is no longer a seam: store.LibraryVersion is
// called directly by scanner/review.
func wireCrossPackageHooks() {
	downloads.EnrichFunc = handlers.EnrichWithPython
	downloads.TranscodeWarmFunc = handlers.WarmTranscodeCache
	scanner.WakeReviewWorker = review.WakeReviewWorker
	scanner.InsertUncheckedReviews = review.DbInsertUncheckedReviews
	scanner.DeleteReview = review.DbDeleteReview
	scanner.SetReviewStatus = review.DbSetReviewStatus
	scanner.SeedReviewUnchecked = review.DbSeedReviewUnchecked
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %s %s — %v", r.Method, r.URL.Path, err)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// ponytail: skip logging for high-frequency liveness polls
		isPoll := r.URL.Path == "/api/stats"
		if strings.HasPrefix(r.URL.Path, "/api/") && !isPoll {
			log.Printf("[http] %s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !isPoll {
			log.Printf("[http] %s %s — %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

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
			!strings.HasPrefix(p, "/api/artist-art/") &&
			!strings.HasPrefix(p, "/api/download/") &&
			!strings.HasPrefix(p, "/api/download-job/") &&
			!strings.HasPrefix(p, "/api/preview/")
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
