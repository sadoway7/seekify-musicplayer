package main

import (
	"encoding/json"
	"fmt"
	"log"
	"mime"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func scanHandler(w http.ResponseWriter, r *http.Request) {
	stats := scanner.ScanMusicDir(store.MusicDir)

	// Scan additional media directories
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		mediaStats := scanner.ScanMusicDirWithPrefix(dir, prefix)
		stats.Scanned += mediaStats.Scanned
		stats.Added += mediaStats.Added
		stats.Removed += mediaStats.Removed
	}

	applyApprovedMatches()
	scanner.AutoSortMusic()
	scanner.ExtractEmbeddedCovers()
	log.Printf("Scan complete: %d scanned, %d added, %d removed", stats.Scanned, stats.Added, stats.Removed)

	go fetchMissingCovers()
	go fetchMissingArtistArt()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

func spaHandler(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Path)
	if path == "/" {
		path = "/index.html"
	}

	q := r.URL.Query()
	playlistID := q.Get("playlist")
	trackID := q.Get("play")
	albumID := q.Get("album")
	artistName := q.Get("artist")

	if playlistID != "" || trackID != "" || albumID != "" || artistName != "" {
		indexPath := filepath.Join(".", "index.html")
		html, err := os.ReadFile(indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		var ogTitle, ogDesc, ogImage string
		host := "http://" + r.Host
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			host = "https://" + r.Host
		}
		ogURL := host + r.URL.RequestURI()

		if playlistID != "" {
			p := store.DbFindPlaylistByID(playlistID)
			if p != nil {
				ogTitle = p.Name + " — Music Playlist"
				ogDesc = fmt.Sprintf("%d tracks. Private Music Library.", len(p.TrackIDs))
			} else {
				ogTitle = "Music Playlist"
				ogDesc = "Private Music Library."
			}
		} else if trackID != "" {
			store.Mu.RLock()
			if t, ok := store.Tracks[trackID]; ok {
				ogTitle = t.Artist + " — " + t.Title
				ogDesc = "Private Music Library."
				if t.AlbumID != "" {
					ogImage = host + "/api/cover/" + t.AlbumID + "?size=300"
				}
			}
			store.Mu.RUnlock()
			if ogTitle == "" {
				ogTitle = "Music"
				ogDesc = "Private Music Library."
			}
		} else if albumID != "" {
			store.Mu.RLock()
			if a, ok := store.Albums[albumID]; ok {
				ogTitle = a.Artist + " — " + a.Name
				ogDesc = fmt.Sprintf("%d tracks. Private Music Library.", a.TrackCount)
				ogImage = host + "/api/cover/" + albumID + "?size=300"
			}
			store.Mu.RUnlock()
			if ogTitle == "" {
				ogTitle = "Music"
				ogDesc = "Private Music Library."
			}
		} else if artistName != "" {
			ogTitle = artistName + " — Music"
			ogDesc = "Private Music Library."
		}

		ogTags := "\n<meta property=\"og:title\" content=\"" + ogTitle + "\">"
		ogTags += "\n<meta property=\"og:description\" content=\"" + ogDesc + "\">"
		ogTags += "\n<meta property=\"og:url\" content=\"" + ogURL + "\">"
		ogTags += "\n<meta property=\"og:type\" content=\"music.playlist\">"
		if ogImage != "" {
			ogTags += "\n<meta property=\"og:image\" content=\"" + ogImage + "\">"
		}
		ogTags += "\n<meta name=\"twitter:card\" content=\"summary\">"
		ogTags += "\n<meta name=\"twitter:title\" content=\"" + ogTitle + "\">"
		ogTags += "\n<meta name=\"twitter:description\" content=\"" + ogDesc + "\">"
		if ogImage != "" {
			ogTags += "\n<meta name=\"twitter:image\" content=\"" + ogImage + "\">"
		}

		htmlStr := string(html)
		htmlStr = strings.Replace(htmlStr, "</title>", "</title>"+ogTags, 1)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(htmlStr))
		return
	}

	fullPath := filepath.Join(".", path)
	info, err := os.Stat(fullPath)
	if err == nil && !info.IsDir() {
		ext := filepath.Ext(fullPath)
		if ct := mime.TypeByExtension(ext); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		http.ServeFile(w, r, fullPath)
		return
	}

	indexPath := filepath.Join(".", "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}
