package handlers

import (
	"encoding/json"
	"fmt"
	htmlpkg "html"
	"log"
	"mime"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// writeJSON sets the Content-Type and encodes v as JSON to w. Replaces the
// repeated w.Header().Set("Content-Type","application/json") + json.NewEncoder(w).Encode(v) pair.
func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// writeJSONError writes a status code and a {"error": msg} JSON body.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ytDlpSem caps concurrent ad-hoc yt-dlp invocations spawned by HTTP handlers
// (URL resolve, search, cookie extract). Without it, a single request that
// pastes 20 URLs spawns 20 yt-dlp processes at once.
var ytDlpSem = make(chan struct{}, 3)

func ScanHandler(w http.ResponseWriter, r *http.Request) {
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

	musicbrainz.ApplyApprovedMatches()
	scanner.AutoSortMusic()
	scanner.ExtractEmbeddedCovers()
	log.Printf("Scan complete: %d scanned, %d added, %d removed", stats.Scanned, stats.Added, stats.Removed)

	store.SafeGo("fetch-covers", func() { musicbrainz.FetchMissingCovers() })
	store.SafeGo("fetch-artist-art", func() { musicbrainz.FetchMissingArtistArt() })

	writeJSON(w, stats)
}

func OpenBrowser(url string) {
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

func SpaHandler(w http.ResponseWriter, r *http.Request) {
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

		ogTags := "\n<meta property=\"og:title\" content=\"" + htmlpkg.EscapeString(ogTitle) + "\">"
		ogTags += "\n<meta property=\"og:description\" content=\"" + htmlpkg.EscapeString(ogDesc) + "\">"
		ogTags += "\n<meta property=\"og:url\" content=\"" + htmlpkg.EscapeString(ogURL) + "\">"
		ogTags += "\n<meta property=\"og:type\" content=\"music.playlist\">"
		if ogImage != "" {
			ogTags += "\n<meta property=\"og:image\" content=\"" + htmlpkg.EscapeString(ogImage) + "\">"
		}
		ogTags += "\n<meta name=\"twitter:card\" content=\"summary\">"
		ogTags += "\n<meta name=\"twitter:title\" content=\"" + htmlpkg.EscapeString(ogTitle) + "\">"
		ogTags += "\n<meta name=\"twitter:description\" content=\"" + htmlpkg.EscapeString(ogDesc) + "\">"
		if ogImage != "" {
			ogTags += "\n<meta name=\"twitter:image\" content=\"" + htmlpkg.EscapeString(ogImage) + "\">"
		}

		htmlStr := string(html)
		htmlStr = strings.Replace(htmlStr, "</title>", "</title>"+ogTags, 1)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
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
		// ponytail: Safari caches JS/CSS aggressively; force revalidation
		if ext == ".js" || ext == ".css" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, fullPath)
		return
	}

	indexPath := filepath.Join(".", "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}
