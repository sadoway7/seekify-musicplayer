package main

import (
	"compress/gzip"
	"encoding/json"
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

	store.Tracks = make(map[string]*models.Track)
	store.Albums = make(map[string]*models.Album)
	store.CoverCache = make(map[string][]byte)
	store.CustomCovers = make(map[string]bool)

	store.InitDB(filepath.Join("data", "music.db"))
	store.LoadCustomCovers()
	downloads.InitDownloadTables()
	watched.InitWatchedTables()
	review.InitReviewTables()

	// Wire scanner callbacks (avoid circular import from scanner -> main)
	downloads.EnrichFunc = handlers.EnrichWithPython
	scanner.WakeReviewWorker = review.WakeReviewWorker
	scanner.InsertUncheckedReviews = review.DbInsertUncheckedReviews
	scanner.LibraryVersionAdd = func(delta int64) { handlers.LibraryVersion.Add(delta) }
	review.LibraryVersionAdd = func(delta int64) { handlers.LibraryVersion.Add(delta) }
	scanner.DeleteReview = review.DbDeleteReview
	scanner.SetReviewStatus = review.DbSetReviewStatus
	scanner.SeedReviewUnchecked = review.DbSeedReviewUnchecked

	// Try loading from DB first
	dbTracks := store.DbLoadTracks()
	dbAlbums := store.DbLoadAlbums()
	if len(dbTracks) > 0 {
		store.Tracks = dbTracks
		store.Albums = dbAlbums
		log.Printf("Loaded %d tracks and %d albums from database", len(store.Tracks), len(store.Albums))
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
	store.RegisterWorker("watched-playlists", "Syncs YouTube watched playlists to library", "Every 1 hour", func() {
		store.SafeGo("watched-refresh-all", func() { watched.RefreshAllWatchedPlaylists() })
	})
	store.RegisterWorker("cover-fetch", "Fetches missing album covers from MusicBrainz", "Startup only", func() {
		musicbrainz.FetchMissingCovers()
	})
	store.RegisterWorker("artist-art-fetch", "Fetches missing artist art from Deezer", "Startup only", func() {
		musicbrainz.FetchMissingArtistArt()
	})

	store.SafeGo("fetch-covers", func() {
		store.WorkerStart("cover-fetch")
		musicbrainz.FetchMissingCovers()
		store.WorkerDone("cover-fetch", nil)
	})
	store.SafeGo("fetch-artist-art", func() {
		store.WorkerStart("artist-art-fetch")
		musicbrainz.FetchMissingArtistArt()
		store.WorkerDone("artist-art-fetch", nil)
	})
	go scanner.StartWatcher()
	go watched.StartWatchScheduler()
	go downloads.DownloadWatchdog()
	go review.StartReviewScheduler()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/library", handlers.LibraryHandler)
	mux.HandleFunc("/api/stats", handlers.StatsHandler)
	mux.HandleFunc("/api/stream/", handlers.StreamHandler)
	mux.HandleFunc("/api/cover/", handlers.CoverHandler)
	mux.HandleFunc("/api/artist-art/", handlers.ArtistArtHandler)
	mux.HandleFunc("/api/artist-art-fetch/", handlers.ArtistArtFetchHandler)
	mux.HandleFunc("/api/scan", handlers.ScanHandler)
	mux.HandleFunc("/api/library-upload", handlers.LibraryUploadHandler)
	mux.HandleFunc("/api/metadata-preview", handlers.MetadataPreviewHandler)
	mux.HandleFunc("/api/playlists", auth.RequireUser(handlers.PlaylistsHandler))
	mux.HandleFunc("/api/playlists/", auth.RequireUser(handlers.PlaylistHandler))
	mux.HandleFunc("/api/favorites", auth.RequireUser(handlers.FavoritesHandler))
	mux.HandleFunc("/api/favorites/", auth.RequireUser(handlers.FavoriteToggleHandler))
	mux.HandleFunc("/api/recent", auth.RequireUser(handlers.RecentHandler))
	mux.HandleFunc("/api/recent/", auth.RequireUser(handlers.RecentAddHandler))
	mux.HandleFunc("/admin", handlers.AdminHandler)
	mux.HandleFunc("/api/v2/resolve-url", handlers.ResolveURLHandler)
	mux.HandleFunc("/api/v2/search", handlers.V2SearchHandler)
	mux.HandleFunc("/ripperv2", handlers.RipperV2Handler)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		ytdlp := downloads.FindYtDlp()
		ffmpeg := downloads.FindFfmpeg()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"yt-dlp": ytdlp,
			"ffmpeg": ffmpeg,
		})
	})
	mux.HandleFunc("/api/setup-status", handlers.SetupStatusHandler)
	mux.HandleFunc("/api/setup", handlers.SetupHandler)
	mux.HandleFunc("/api/login", handlers.LoginHandler)
	mux.HandleFunc("/api/logout", handlers.LogoutHandler)
	mux.HandleFunc("/api/me", handlers.MeHandler)
	mux.HandleFunc("/api/users/me/password", auth.RequireUser(handlers.ChangeOwnPasswordHandler))
	mux.HandleFunc("/api/files", handlers.RequireAdmin(handlers.FileListHandler))
	mux.HandleFunc("/api/upload", handlers.RequireAdmin(handlers.UploadHandler))
	mux.HandleFunc("/api/delete", handlers.RequireAdmin(handlers.DeleteFileHandler))
	mux.HandleFunc("/api/folders", handlers.RequireAdmin(handlers.CreateFolderHandler))

	mux.HandleFunc("/api/download/", handlers.DownloadHandler)
	mux.HandleFunc("/api/admin/downloads", handlers.RequireAdmin(handlers.DownloadsListHandler))
	mux.HandleFunc("/api/admin/download-toggle/", handlers.RequireAdmin(handlers.DownloadToggleHandler))
	mux.HandleFunc("/api/admin/downloads-enable-all", handlers.RequireAdmin(handlers.DownloadsEnableAllHandler))
	mux.HandleFunc("/api/workers", handlers.RequireAdmin(handlers.WorkersHandler))
	mux.HandleFunc("/api/workers/run", handlers.RequireAdmin(handlers.WorkerRunHandler))

	// Debug: view production server logs (admin-protected).
	mux.HandleFunc("/api/admin/logs", handlers.RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if r.URL.Query().Get("tracks") != "" {
			w.Write(store.FilterTrackLogs())
		} else {
			w.Write(store.GetLogBuffer())
		}
	}))

	mux.HandleFunc("/api/waveform/", handlers.WaveformHandler)
	mux.HandleFunc("/api/track-duration/", handlers.TrackDurationHandler)
	mux.HandleFunc("/waveform-test", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "waveform-test.html")
	})
	mux.HandleFunc("/api/metadata/scan", handlers.MetadataScanHandler)
	mux.HandleFunc("/api/metadata/rescan/", handlers.MetadataRescanHandler)
	mux.HandleFunc("/api/metadata/rescan-sync/", handlers.MetadataRescanSyncHandler)
	mux.HandleFunc("/api/metadata/search", handlers.MetadataSearchHandler)
	mux.HandleFunc("/api/metadata/update-track/", handlers.MetadataUpdateTrackHandler)
	mux.HandleFunc("/api/metadata/scan-progress", handlers.MetadataScanProgressHandler)
	mux.HandleFunc("/api/metadata/pending", handlers.MetadataPendingHandler)
	mux.HandleFunc("/api/metadata/all", handlers.MetadataAllHandler)
	mux.HandleFunc("/api/metadata/approve/", handlers.MetadataApproveHandler)
	mux.HandleFunc("/api/metadata/reject/", handlers.MetadataRejectHandler)
	mux.HandleFunc("/api/metadata/approve-all", handlers.MetadataApproveAllHandler)
	mux.HandleFunc("/api/metadata/clear", handlers.MetadataClearHandler)
	mux.HandleFunc("/api/metadata/counts", handlers.MetadataCountsHandler)
	mux.HandleFunc("/api/metadata/undo/", handlers.MetadataUndoHandler)

	mux.HandleFunc("/api/finder/search", handlers.FinderSearchHandler)
	mux.HandleFunc("/api/finder/artist/", handlers.FinderArtistReleasesHandler)
	mux.HandleFunc("/api/finder/artist-track-progress", handlers.ArtistTrackProgressHandler)
	mux.HandleFunc("/api/finder/release/", handlers.FinderReleaseTracksHandler)
	mux.HandleFunc("/api/finder/cover/", handlers.FinderCoverHandler)
	mux.HandleFunc("/api/finder/youtube", handlers.YoutubeSearchHandler)
	mux.HandleFunc("/api/preview/", handlers.PreviewAudioHandler)
	mux.HandleFunc("/api/download-job/", handlers.DownloadJobFileHandler)

	mux.HandleFunc("/api/queue", auth.RequireUser(handlers.DownloadQueueHandler))
	mux.HandleFunc("/api/queue/add", auth.RequireUser(handlers.DownloadQueueAddHandler))
	mux.HandleFunc("/api/queue/add-batch", auth.RequireUser(handlers.DownloadQueueAddBatchHandler))
	mux.HandleFunc("/api/queue/counts", auth.RequireUser(handlers.QueueCountsHandler))
	mux.HandleFunc("/api/queue/clear-completed", auth.RequireUser(handlers.QueueClearCompletedHandler))
	mux.HandleFunc("/api/queue/toggle-pause", auth.RequireUser(handlers.DownloadTogglePauseHandler))
	mux.HandleFunc("/api/soulseek/connect", auth.RequireAdmin(handlers.SoulseekConnectHandler))
	mux.HandleFunc("/api/queue/", auth.RequireUser(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/retry") {
			handlers.DownloadJobRetryHandler(w, r)
		} else if strings.HasSuffix(path, "/delete") {
			handlers.DownloadJobDeleteHandler(w, r)
		} else if strings.HasSuffix(path, "/select") {
			handlers.DownloadJobSelectHandler(w, r)
		} else {
			handlers.DownloadJobStatusHandler(w, r)
		}
	}))

	mux.HandleFunc("/api/bulk-import", handlers.BulkImportHandler)

	mux.HandleFunc("/api/shared-queue", handlers.SharedQueueCreateHandler)
	mux.HandleFunc("/api/shared-queue/", handlers.SharedQueueGetHandler)

	mux.HandleFunc("/api/playlist-import", handlers.PlaylistImportHandler)
	mux.HandleFunc("/api/watch/", handlers.WatchedPlaylistsHandler)
	mux.HandleFunc("/api/watch", handlers.WatchedPlaylistsHandler)

	mux.HandleFunc("/api/settings", auth.RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handlers.SettingsSetHandler(w, r)
		} else {
			handlers.SettingsGetHandler(w, r)
		}
	}))

	mux.HandleFunc("/api/cookies/upload", handlers.CorsAny(handlers.UploadCookiesHandler))
	mux.HandleFunc("/api/cookies/clear", handlers.ClearCookiesHandler)
	mux.HandleFunc("/api/cookies/extract", handlers.ExtractCookiesHandler)
	mux.HandleFunc("/api/cookies/status", handlers.CookiesStatusHandler)
	mux.HandleFunc("/api/cookies/extension.zip", ExtensionZipHandler)

	mux.HandleFunc("/api/review/tracks", review.ReviewTracksHandler)
	mux.HandleFunc("/api/review/counts", review.ReviewCountsHandler)
	mux.HandleFunc("/api/review/mark-ok", review.ReviewMarkOkHandler)
	mux.HandleFunc("/api/review/edit-meta", review.ReviewEditMetaHandler)
	mux.HandleFunc("/api/review/upload-cover", handlers.UploadCustomCoverHandler)
	mux.HandleFunc("/api/review/clear-cover", handlers.ClearCustomCoverHandler)
	mux.HandleFunc("/api/review/delete", review.ReviewDeleteHandler)
	mux.HandleFunc("/api/review/delete-all", review.ReviewDeleteAllHandler)
	mux.HandleFunc("/api/review/bulk-delete", review.ReviewBulkDeleteHandler)
	mux.HandleFunc("/api/review/bulk-approve", review.ReviewBulkApproveHandler)
	mux.HandleFunc("/api/review/recheck-all", review.ReviewRecheckAllHandler)
	mux.HandleFunc("/api/review/enrich", review.ReviewEnrichHandler)
	mux.HandleFunc("/api/review/progress", review.ReviewProgressHandler)
	mux.HandleFunc("/api/review/log", review.ReviewLogHandler)

	var handler http.Handler = mux
	handler = auth.SessionLoad(handler)
	handler = loggingMiddleware(recoveryMiddleware(handler))
	handler = gzipMiddleware(handler)

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

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server error: %v", err)
	}
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
