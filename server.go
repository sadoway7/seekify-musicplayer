package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	dirFlag := flag.String("dir", "", "Path to music directory")
	flag.Parse()

	musicDir = *dirFlag
	if musicDir == "" {
		musicDir = os.Getenv("MUSIC_DIR")
	}
	if musicDir == "" {
		exe, err := os.Executable()
		if err == nil {
			musicDir = filepath.Join(filepath.Dir(exe), "music")
		} else {
			musicDir = "music"
		}
	}
	os.MkdirAll(musicDir, 0755)

	absDir, err := filepath.Abs(musicDir)
	if err != nil {
		log.Fatalf("Could not resolve music directory path: %v", err)
	}
	musicDir = absDir

	info, err := os.Stat(musicDir)
	if err != nil || !info.IsDir() {
		log.Fatalf("Music directory does not exist: %s", musicDir)
	}

	// Initialize musicDirs with the primary directory
	musicDirs = map[string]string{"": musicDir}

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
		musicDirs["media"] = absMedia
		log.Printf("Media music directory: %s", absMedia)
	}

	tracks = make(map[string]*Track)
	albums = make(map[string]*Album)
	coverCache = make(map[string][]byte)

	initDB(filepath.Join("data", "music.db"))

	// Try loading from DB first
	dbTracks := dbLoadTracks()
	dbAlbums := dbLoadAlbums()
	if len(dbTracks) > 0 {
		tracks = dbTracks
		albums = dbAlbums
		log.Printf("Loaded %d tracks and %d albums from database", len(tracks), len(albums))
	}

	// Covers and artist art are lazy-loaded from disk on first request

	ytdlp := findYtDlp()
	ffmpeg := findFfmpeg()
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

	// Check if file counts match DB — skip full scan if nothing changed
	needScan := len(dbTracks) == 0
	if !needScan {
		for prefix, dir := range musicDirs {
			if prefix != "" {
				continue
			}
			count := countAudioFiles(dir)
			if count != len(dbTracks) {
				log.Printf("Primary dir file count changed (%d in DB vs %d on disk), rescanning", len(dbTracks), count)
				needScan = true
			}
			break
		}
		if !needScan {
			for prefix, dir := range musicDirs {
				if prefix == "" {
					continue
				}
				count := countAudioFiles(dir)
				mediaDBCount := 0
				for _, t := range tracks {
					if strings.HasPrefix(t.FilePath, prefix+":") {
						mediaDBCount++
					}
				}
				if count != mediaDBCount {
					log.Printf("Media dir [%s] file count changed (%d in DB vs %d on disk), rescanning", prefix, mediaDBCount, count)
					needScan = true
				}
				break
			}
		}
	}

	if needScan {
		// Scan primary music directory
		log.Printf("Scanning music directory: %s", musicDir)
		stats := scanMusicDir(musicDir)
		log.Printf("Primary scan complete: %d files found, %d tracks loaded", stats.Scanned, len(tracks))

		// Scan additional media directories
		for prefix, dir := range musicDirs {
			if prefix == "" {
				continue
			}
			log.Printf("Scanning media directory [%s]: %s", prefix, dir)
			mediaStats := scanMusicDirWithPrefix(dir, prefix)
			log.Printf("Media scan [%s] complete: %d files found, %d tracks loaded", prefix, mediaStats.Scanned, len(tracks))
		}

		// Cleanup recent/favorites AFTER all scans so media track IDs exist
		dbCleanupFavorites()
		dbCleanupRecent()
	} else {
		log.Printf("File counts match DB, skipping full scan")
	}

	applied := applyApprovedMatches()
	if applied > 0 {
		log.Printf("Applied %d metadata overrides from database", applied)
	}

	extractEmbeddedCovers()
	go fetchMissingCovers()
	go fetchMissingArtistArt()
	go startWatcher()
	go startWatchScheduler()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/library", libraryHandler)
	mux.HandleFunc("/api/stats", statsHandler)
	mux.HandleFunc("/api/stream/", streamHandler)
	mux.HandleFunc("/api/cover/", coverHandler)
	mux.HandleFunc("/api/artist-art/", artistArtHandler)
	mux.HandleFunc("/api/artist-art-fetch/", artistArtFetchHandler)
	mux.HandleFunc("/api/scan", scanHandler)
	mux.HandleFunc("/api/playlists", playlistsHandler)
	mux.HandleFunc("/api/playlists/", playlistHandler)
	mux.HandleFunc("/api/favorites", favoritesHandler)
	mux.HandleFunc("/api/favorites/", favoriteToggleHandler)
	mux.HandleFunc("/api/recent", recentHandler)
	mux.HandleFunc("/api/recent/", recentAddHandler)
	mux.HandleFunc("/admin", adminHandler)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		ytdlp := findYtDlp()
		ffmpeg := findFfmpeg()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"yt-dlp": ytdlp,
			"ffmpeg": ffmpeg,
		})
	})
	mux.HandleFunc("/api/admin-login", adminLoginHandler)
	mux.HandleFunc("/api/files", requireAdmin(fileListHandler))
	mux.HandleFunc("/api/upload", requireAdmin(uploadHandler))
	mux.HandleFunc("/api/delete", requireAdmin(deleteFileHandler))
	mux.HandleFunc("/api/folders", requireAdmin(createFolderHandler))

	mux.HandleFunc("/api/download/", downloadHandler)
	mux.HandleFunc("/api/admin/downloads", requireAdmin(downloadsListHandler))
	mux.HandleFunc("/api/admin/download-toggle/", requireAdmin(downloadToggleHandler))

	mux.HandleFunc("/api/track-duration/", trackDurationHandler)
	mux.HandleFunc("/api/metadata/scan", metadataScanHandler)
	mux.HandleFunc("/api/metadata/rescan/", metadataRescanHandler)
	mux.HandleFunc("/api/metadata/rescan-sync/", metadataRescanSyncHandler)
	mux.HandleFunc("/api/metadata/update-track/", metadataUpdateTrackHandler)
	mux.HandleFunc("/api/metadata/scan-progress", metadataScanProgressHandler)
	mux.HandleFunc("/api/metadata/pending", metadataPendingHandler)
	mux.HandleFunc("/api/metadata/all", metadataAllHandler)
	mux.HandleFunc("/api/metadata/approve/", metadataApproveHandler)
	mux.HandleFunc("/api/metadata/reject/", metadataRejectHandler)
	mux.HandleFunc("/api/metadata/approve-all", metadataApproveAllHandler)
	mux.HandleFunc("/api/metadata/clear", metadataClearHandler)
	mux.HandleFunc("/api/metadata/counts", metadataCountsHandler)
	mux.HandleFunc("/api/metadata/undo/", metadataUndoHandler)

	mux.HandleFunc("/api/finder/search", finderSearchHandler)
	mux.HandleFunc("/api/finder/artist/", finderArtistReleasesHandler)
	mux.HandleFunc("/api/finder/release/", finderReleaseTracksHandler)
	mux.HandleFunc("/api/finder/cover/", finderCoverHandler)
	mux.HandleFunc("/api/finder/youtube", youtubeSearchHandler)
	mux.HandleFunc("/api/preview/", previewAudioHandler)
	mux.HandleFunc("/api/download-job/", downloadJobFileHandler)

	mux.HandleFunc("/api/queue", downloadQueueHandler)
	mux.HandleFunc("/api/queue/add", downloadQueueAddHandler)
	mux.HandleFunc("/api/queue/add-batch", downloadQueueAddBatchHandler)
	mux.HandleFunc("/api/queue/counts", queueCountsHandler)
	mux.HandleFunc("/api/queue/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/retry") {
			downloadJobRetryHandler(w, r)
		} else if strings.HasSuffix(path, "/delete") {
			downloadJobDeleteHandler(w, r)
		} else {
			downloadJobStatusHandler(w, r)
		}
	})

	mux.HandleFunc("/api/bulk-import", bulkImportHandler)

	mux.HandleFunc("/api/playlist-import", playlistImportHandler)
	mux.HandleFunc("/api/watch/", watchedPlaylistsHandler)
	mux.HandleFunc("/api/watch", watchedPlaylistsHandler)

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			settingsSetHandler(w, r)
		} else {
			settingsGetHandler(w, r)
		}
	})

	var handler http.Handler = mux
	handler = loggingMiddleware(recoveryMiddleware(handler))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		spaHandler(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	addr := ":" + port
	url := fmt.Sprintf("http://localhost%s", addr)

	log.Printf("Starting server on %s", addr)
	log.Printf("Open %s in your browser", url)

	go func() {
		time.Sleep(500 * time.Millisecond)
		openBrowser(url)
	}()

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
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("[http] %s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("[http] %s %s — %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}
