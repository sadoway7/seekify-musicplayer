package main

import (
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

	loadCachedCovers()
	loadCachedArtistArt()

	log.Printf("Scanning music directory: %s", musicDir)
	stats := scanMusicDir(musicDir)
	log.Printf("Scan complete: %d files found, %d tracks loaded", stats.Scanned, len(tracks))

	applied := applyApprovedMatches()
	if applied > 0 {
		log.Printf("Applied %d metadata overrides from database", applied)
	}

	extractEmbeddedCovers()
	go fetchMissingCovers()
	go fetchMissingArtistArt()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/library", libraryHandler)
	mux.HandleFunc("/api/stream/", streamHandler)
	mux.HandleFunc("/api/cover/", coverHandler)
	mux.HandleFunc("/api/artist-art/", artistArtHandler)
	mux.HandleFunc("/api/scan", scanHandler)
	mux.HandleFunc("/api/playlists", playlistsHandler)
	mux.HandleFunc("/api/playlists/", playlistHandler)
	mux.HandleFunc("/api/favorites", favoritesHandler)
	mux.HandleFunc("/api/favorites/", favoriteToggleHandler)
	mux.HandleFunc("/api/recent", recentHandler)
	mux.HandleFunc("/api/recent/", recentAddHandler)
	mux.HandleFunc("/admin", adminHandler)
	mux.HandleFunc("/api/admin-login", adminLoginHandler)
	mux.HandleFunc("/api/files", requireAdmin(fileListHandler))
	mux.HandleFunc("/api/upload", requireAdmin(uploadHandler))
	mux.HandleFunc("/api/delete", requireAdmin(deleteFileHandler))
	mux.HandleFunc("/api/folders", requireAdmin(createFolderHandler))

	mux.HandleFunc("/api/metadata/scan", metadataScanHandler)
	mux.HandleFunc("/api/metadata/resync/", metadataRescanHandler)
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
