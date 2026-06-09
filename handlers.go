package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// libraryVersion is incremented whenever the library changes (scan, watcher, metadata update).
var libraryVersion atomic.Int64

func statsHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	trackCount := len(tracks)
	albumCount := len(albums)
	mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks":   trackCount,
		"albums":   albumCount,
		"version":  libraryVersion.Load(),
	})
}

func libraryHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()

	trackList := make([]Track, 0, len(tracks))
	for _, t := range tracks {
		trackList = append(trackList, *t)
	}
	sort.Slice(trackList, func(i, j int) bool {
		return trackList[i].Title < trackList[j].Title
	})

	albumList := make([]Album, 0, len(albums))
	for _, a := range albums {
		albumList = append(albumList, *a)
	}
	sort.Slice(albumList, func(i, j int) bool {
		return albumList[i].Name < albumList[j].Name
	})

	artistMap := make(map[string]*Artist)
	for _, t := range tracks {
		name := t.Artist
		if _, exists := artistMap[name]; !exists {
			artistMap[name] = &Artist{Name: name}
		}
		artistMap[name].TrackCount++
	}
	for _, a := range albums {
		name := a.Artist
		if _, exists := artistMap[name]; exists {
			artistMap[name].AlbumCount++
		}
	}

	artistList := make([]Artist, 0, len(artistMap))
	for _, a := range artistMap {
		artistList = append(artistList, *a)
	}
	sort.Slice(artistList, func(i, j int) bool {
		return artistList[i].Name < artistList[j].Name
	})

	resp := LibraryResponse{
		Tracks:  trackList,
		Albums:  albumList,
		Artists: artistList,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/stream/")

	mu.RLock()
	track, exists := tracks[id]
	mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	fullPath := resolveFilePath(track.FilePath)
	file, err := os.Open(fullPath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "Could not stat file", http.StatusInternalServerError)
		return
	}

	fileSize := stat.Size()
	ext := strings.ToLower(filepath.Ext(fullPath))
	contentType := audioExtensions[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		rangeStr := strings.TrimPrefix(rangeHeader, "bytes=")
		parts := strings.Split(rangeStr, "-")
		if len(parts) != 2 {
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		var start, end int64
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		if parts[1] == "" {
			end = fileSize - 1
		} else {
			end, err = strconv.ParseInt(parts[1], 10, 64)
			if err != nil {
				http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
		}

		if start > end || start >= fileSize {
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		if end >= fileSize {
			end = fileSize - 1
		}

		contentLength := end - start + 1
		file.Seek(start, io.SeekStart)

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusPartialContent)
		io.CopyN(w, file, contentLength)
	} else {
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		io.Copy(w, file)
	}
}

func coverHandler(w http.ResponseWriter, r *http.Request) {
	albumID := strings.TrimPrefix(r.URL.Path, "/api/cover/")

	coverMu.RLock()
	data, exists := coverCache[albumID]
	coverMu.RUnlock()

	if exists {
		contentType := http.DetectContentType(data)
		if strings.HasPrefix(contentType, "application/") || strings.HasPrefix(contentType, "text/") {
			contentType = "image/jpeg"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(data)
		return
	}

	coverPath := filepath.Join(musicDir, "images", albumID+".jpg")
	if diskData, err := os.ReadFile(coverPath); err == nil {
		coverMu.Lock()
		coverCache[albumID] = diskData
		coverMu.Unlock()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(diskData)
		return
	}

	mu.RLock()
	var albumName string
	for _, a := range albums {
		if a.ID == albumID {
			albumName = a.Name
			break
		}
	}
	mu.RUnlock()

	svg := generatePlaceholderSVG(albumName, albumID)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write([]byte(svg))
}

func artistArtHandler(w http.ResponseWriter, r *http.Request) {
	artistName := strings.TrimPrefix(r.URL.Path, "/api/artist-art/")
	if artistName == "" {
		http.Error(w, "Artist name required", http.StatusBadRequest)
		return
	}

	key := strings.ToLower(strings.TrimSpace(artistName))

	artistArtMu.RLock()
	data, exists := artistArtCache[key]
	artistArtMu.RUnlock()

	if exists {
		contentType := http.DetectContentType(data)
		if strings.HasPrefix(contentType, "application/") || strings.HasPrefix(contentType, "text/") {
			contentType = "image/jpeg"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(data)
		return
	}

	artDir := filepath.Join(musicDir, "images", "artists")
	artFile := filepath.Join(artDir, key+".jpg")
	if diskData, err := os.ReadFile(artFile); err == nil {
		artistArtMu.Lock()
		artistArtCache[key] = diskData
		artistArtMu.Unlock()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(diskData)
		return
	}

	// Fallback: use first album cover for this artist
	mu.RLock()
	for _, a := range albums {
		if a.Artist == "" || strings.ToLower(strings.TrimSpace(a.Artist)) != key {
			continue
		}
		if !a.HasCover {
			continue
		}
		coverPath := filepath.Join(musicDir, "images", a.ID+".jpg")
		if coverData, err := os.ReadFile(coverPath); err == nil {
			mu.RUnlock()
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			w.Write(coverData)
			return
		}
	}
	mu.RUnlock()

	svg := generatePlaceholderSVG(artistName, artistName)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write([]byte(svg))
}

func artistArtFetchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	artistName := strings.TrimPrefix(r.URL.Path, "/api/artist-art-fetch/")
	if artistName == "" {
		http.Error(w, "Artist name required", http.StatusBadRequest)
		return
	}

	fetched := fetchArtistImage(artistName)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"fetched": fetched})
}

func scanHandler(w http.ResponseWriter, r *http.Request) {
	stats := scanMusicDir(musicDir)

	// Scan additional media directories
	for prefix, dir := range musicDirs {
		if prefix == "" {
			continue
		}
		mediaStats := scanMusicDirWithPrefix(dir, prefix)
		stats.Scanned += mediaStats.Scanned
		stats.Added += mediaStats.Added
		stats.Removed += mediaStats.Removed
	}

	applyApprovedMatches()
	autoSortMusic()
	extractEmbeddedCovers()
	log.Printf("Scan complete: %d scanned, %d added, %d removed", stats.Scanned, stats.Added, stats.Removed)

	go fetchMissingCovers()
	go fetchMissingArtistArt()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func playlistsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		playlists := dbGetPlaylists()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(playlists)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if body.Name == "" {
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		playlist := dbCreatePlaylist(body.Name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(playlist)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func playlistHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/playlists/")

	switch r.Method {
	case http.MethodPut:
		var body struct {
			Name     string   `json:"name"`
			TrackIDs []string `json:"trackIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		dbUpdatePlaylist(id, body.Name, body.TrackIDs)

		w.Header().Set("Content-Type", "application/json")
		playlists := dbGetPlaylists()
		for _, p := range playlists {
			if p.ID == id {
				json.NewEncoder(w).Encode(p)
				return
			}
		}
		http.Error(w, "Playlist not found", http.StatusNotFound)

	case http.MethodDelete:
		if !dbDeletePlaylist(id) {
			http.Error(w, "Playlist not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"deleted": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func favoritesHandler(w http.ResponseWriter, r *http.Request) {
	favorites := dbGetFavorites()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(favorites)
}

func favoriteToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimPrefix(r.URL.Path, "/api/favorites/")
	if trackID == "" {
		http.Error(w, "missing track id", http.StatusBadRequest)
		return
	}
	added := dbToggleFavorite(trackID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"added": added})
}

func recentHandler(w http.ResponseWriter, r *http.Request) {
	recent := dbGetRecent()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(recent)
}

func recentAddHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/recent/")
	dbAddRecent(trackID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"added": true})
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

const adminPasscode = "countstuff2026"

func requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !adminAuthCheck(r) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func adminAuthCheck(r *http.Request) bool {
	cookie, err := r.Cookie("admin_auth")
	if err != nil {
		return false
	}
	return cookie.Value == "1"
}

func adminHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if adminAuthCheck(r) {
		http.ServeFile(w, r, "admin.html")
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Settings Locked</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0E0E0E;color:#F0EFE9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
</style>
</head>
<body>
<div style="text-align:center;max-width:320px;width:100%">
  <div style="width:56px;height:56px;margin:0 auto 20px;border-radius:16px;background:#1E1E1E;display:flex;align-items:center;justify-content:center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4F040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>
  <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">Settings Locked</h2>
  <p style="font-size:13px;color:#888;margin-bottom:24px">Enter the access code to continue</p>
  <input id="code" type="password" autocomplete="off" autofocus placeholder="Access code" style="width:100%;padding:14px 16px;background:#1E1E1E;border:2px solid #2a2a2a;border-radius:12px;color:#F0EFE9;font-size:18px;text-align:center;letter-spacing:0.15em;outline:none;transition:border-color 0.2s">
  <div id="err" style="font-size:13px;color:#f87171;min-height:20px;margin-top:12px"></div>
</div>
<script>
(function(){
  var inp=document.getElementById("code");
  var err=document.getElementById("err");
  inp.focus();
  inp.addEventListener("input",function(){err.textContent="";inp.style.borderColor="#2a2a2a"});
  inp.addEventListener("keydown",function(e){
    if(e.key==="Enter"){
      e.preventDefault();
      var v=inp.value;
      fetch("/api/admin-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:v})}).then(function(r){return r.json()}).then(function(d){
        if(d.ok){window.location.reload()}else{err.textContent="Incorrect code";inp.style.borderColor="#f87171";inp.value="";inp.focus()}
      }).catch(function(){err.textContent="Error";inp.value=""});
    }
  });
})();
</script>
</body>
</html>`))
}

func adminLoginHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if body.Code != adminPasscode {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":false}`))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "admin_auth",
		Value:    "1",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func fileListHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")

	dirPath := filepath.Join(musicDir, subPath)
	dirPath = filepath.Clean(dirPath)

	if !strings.HasPrefix(dirPath, musicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		http.Error(w, "Could not read directory", http.StatusInternalServerError)
		return
	}

	type fileInfo struct {
		Name    string `json:"name"`
		Path    string `json:"path"`
		IsDir   bool   `json:"isDir"`
		Size    int64  `json:"size"`
		ModTime string `json:"modTime"`
	}

	var dirs []fileInfo
	var files []fileInfo

	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		relPath := filepath.Join(subPath, entry.Name())

		if entry.IsDir() {
			dirs = append(dirs, fileInfo{
				Name:    entry.Name(),
				Path:    relPath,
				IsDir:   true,
				Size:    0,
				ModTime: info.ModTime().Format(time.RFC3339),
			})
		} else {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if _, ok := audioExtensions[ext]; ok {
				files = append(files, fileInfo{
					Name:    entry.Name(),
					Path:    relPath,
					IsDir:   false,
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.RFC3339),
				})
			}
		}
	}

	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].Name < dirs[j].Name
	})
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})

	result := append(dirs, files...)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500*1024*1024)

	if err := r.ParseMultipartForm(500 * 1024 * 1024); err != nil {
		http.Error(w, "Upload too large", http.StatusRequestEntityTooLarge)
		return
	}

	subPath := r.FormValue("path")
	targetDir := filepath.Join(musicDir, subPath)
	targetDir = filepath.Clean(targetDir)

	if !strings.HasPrefix(targetDir, musicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		http.Error(w, "Could not create directory", http.StatusInternalServerError)
		return
	}

	var uploaded []string
	var uploadErrors []string

	formFiles := r.MultipartForm.File["files"]
	for _, fh := range formFiles {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if _, ok := audioExtensions[ext]; !ok {
			uploadErrors = append(uploadErrors, fh.Filename+": not an audio file")
			continue
		}

		src, err := fh.Open()
		if err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": could not read file")
			continue
		}

		dstPath := filepath.Join(targetDir, filepath.Base(fh.Filename))
		dst, err := os.Create(dstPath)
		if err != nil {
			src.Close()
			uploadErrors = append(uploadErrors, fh.Filename+": could not save file")
			continue
		}

		_, err = io.Copy(dst, src)
		dst.Close()
		src.Close()

		if err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": write error")
			continue
		}

		uploaded = append(uploaded, fh.Filename)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"uploaded": uploaded,
		"errors":   uploadErrors,
	})
}

func deleteFileHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")
	subPath = filepath.Clean(subPath)

	if strings.Contains(subPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(musicDir, subPath)
	fullPath = filepath.Clean(fullPath)

	if !strings.HasPrefix(fullPath, musicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.Remove(fullPath); err != nil {
		http.Error(w, "Could not delete file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"deleted": true})
}

func createFolderHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	body.Name = filepath.Base(body.Name)
	if body.Name == "" || body.Name == "." {
		http.Error(w, "Invalid folder name", http.StatusBadRequest)
		return
	}

	targetPath := filepath.Join(musicDir, body.Path, body.Name)
	targetPath = filepath.Clean(targetPath)

	if !strings.HasPrefix(targetPath, musicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(targetPath, 0755); err != nil {
		http.Error(w, "Could not create folder", http.StatusInternalServerError)
		return
	}

	relPath := filepath.Join(body.Path, body.Name)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"created": true,
		"path":    relPath,
	})
}

func downloadHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/download/")

	mu.RLock()
	track, exists := tracks[id]
	mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	if !track.DownloadEnabled {
		http.Error(w, "Downloads not enabled for this track", http.StatusForbidden)
		return
	}

	fullPath := resolveFilePath(track.FilePath)
	file, err := os.Open(fullPath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "Could not stat file", http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(fullPath))
	contentType := audioExtensions[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Build a friendly filename: Artist - Title.ext
	filename := filepath.Base(fullPath)
	if track.Artist != "" && track.Title != "" {
		filename = sanitizePath(track.Artist) + " - " + sanitizePath(track.Title) + ext
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	http.ServeContent(w, r, filename, stat.ModTime(), file)
}

func downloadsListHandler(w http.ResponseWriter, r *http.Request) {
	ids := dbGetDownloadableTracks()

	type downloadTrack struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Artist  string `json:"artist"`
		Album   string `json:"album"`
		Enabled bool   `json:"enabled"`
	}

	var result []downloadTrack
	mu.RLock()
	for _, id := range ids {
		if t, ok := tracks[id]; ok {
			result = append(result, downloadTrack{
				ID:      t.ID,
				Title:   t.Title,
				Artist:  t.Artist,
				Album:   t.Album,
				Enabled: true,
			})
		}
	}
	mu.RUnlock()

	if result == nil {
		result = []downloadTrack{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func downloadToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trackID := strings.TrimPrefix(r.URL.Path, "/api/admin/download-toggle/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	mu.RLock()
	_, exists := tracks[trackID]
	mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	enabled := dbToggleDownload(trackID)

	mu.Lock()
	if t, ok := tracks[trackID]; ok {
		t.DownloadEnabled = enabled
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"enabled": enabled})
}

func trackDurationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trackID := strings.TrimPrefix(r.URL.Path, "/api/track-duration/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	var body struct {
		Duration int `json:"duration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if body.Duration <= 0 {
		http.Error(w, "Invalid duration", http.StatusBadRequest)
		return
	}

	mu.Lock()
	if t, ok := tracks[trackID]; ok {
		if t.Duration == 0 {
			t.Duration = body.Duration
			db.Exec("UPDATE tracks SET duration = ? WHERE id = ?", body.Duration, trackID)
		}
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"updated": true})
}

func metadataScanHandler(w http.ResponseWriter, r *http.Request) {
	metaScanLock.Lock()
	if metaScan.Running {
		metaScanLock.Unlock()
		http.Error(w, "Scan already in progress", http.StatusConflict)
		return
	}
	metaScanLock.Unlock()

	go scanMetadataForTracks()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "started",
	})
}

func metadataRescanHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	mu.RLock()
	track, exists := tracks[trackID]
	mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	db.Exec("DELETE FROM metadata_matches WHERE track_id = ?", trackID)

	go func() {
		searchTitle := track.Title
		searchArtist := track.Artist
		if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(titleFromFilename(track.FilePath)) {
			searchTitle = titleFromFilename(track.FilePath)
		}
		log.Printf("[metadata] Rescanning single track: %s - %s", searchArtist, searchTitle)

		candidates, err := mbSearchRecordings(searchArtist, searchTitle, 10)
		if err != nil {
			log.Printf("[metadata] Rescan failed for %q - %q: %v", searchArtist, searchTitle, err)
			return
		}

		inserted := 0
		for _, cand := range candidates {
			score := scoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)
			if score < 0.5 {
				continue
			}

			mu.RLock()
			hasCover := false
			if cand.AlbumID != "" {
				coverPath := filepath.Join(musicDir, "images", cand.AlbumID+".jpg")
				if _, err := os.Stat(coverPath); err == nil {
					hasCover = true
				}
			}
			mu.RUnlock()

			match := &MetadataMatch{
				ID:          generateUUID(),
				TrackID:     trackID,
				TrackTitle:  searchTitle,
				TrackArtist: searchArtist,
				MBTitle:     cand.Title,
				MBArtist:    cand.Artist,
				MBAlbum:     cand.Album,
				MBAlbumID:   cand.AlbumID,
				MBScore:     score,
				Status:      "pending",
				HasCover:    hasCover,
				FilePath:    track.FilePath,
			}
			dbInsertMetadataMatch(match)
			inserted++
		}
		log.Printf("[metadata] Rescan complete: %d candidates found for %s - %s", inserted, searchArtist, searchTitle)
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "started",
	})
}

func metadataRescanSyncHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan-sync/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	mu.RLock()
	track, exists := tracks[trackID]
	mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	searchTitle := track.Title
	searchArtist := track.Artist
	if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(titleFromFilename(track.FilePath)) {
		searchTitle = titleFromFilename(track.FilePath)
	}

	candidates, err := mbSearchRecordings(searchArtist, searchTitle, 20)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	type rescanCandidate struct {
		Title    string  `json:"title"`
		Artist   string  `json:"artist"`
		Album    string  `json:"album"`
		AlbumID  string  `json:"albumId"`
		Score    float64 `json:"score"`
		HasCover bool    `json:"hasCover"`
	}

	var results []rescanCandidate
	for _, cand := range candidates {
		score := scoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)

		mu.RLock()
		hasCover := false
		if cand.AlbumID != "" {
			coverPath := filepath.Join(musicDir, "images", cand.AlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				hasCover = true
			}
		}
		mu.RUnlock()

		results = append(results, rescanCandidate{
			Title:    cand.Title,
			Artist:   cand.Artist,
			Album:    cand.Album,
			AlbumID:  cand.AlbumID,
			Score:    score,
			HasCover: hasCover,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func metadataUpdateTrackHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/update-track/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	var body struct {
		Title       string `json:"title"`
		Artist      string `json:"artist"`
		Album       string `json:"album"`
		AlbumArtist string `json:"albumArtist"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	mu.Lock()
	track, exists := tracks[trackID]
	if !exists {
		mu.Unlock()
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	if body.Title != "" {
		track.Title = body.Title
	}
	if body.Artist != "" {
		track.Artist = body.Artist
	}
	if body.Album != "" {
		track.Album = body.Album
	}
	if body.AlbumArtist != "" {
		track.AlbumArtist = body.AlbumArtist
	}
	if track.AlbumArtist == "" {
		track.AlbumArtist = track.Artist
	}
	if track.Album != "" {
		track.AlbumID = generateAlbumID(track.AlbumArtist, track.Album)
	}
	track.HasMetadata = true

	dbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)
	rebuildAlbumsFromTracks()
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"updated": true})
}

func metadataScanProgressHandler(w http.ResponseWriter, r *http.Request) {
	p := getScanProgress()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func metadataPendingHandler(w http.ResponseWriter, r *http.Request) {
	matches := dbGetPendingMatches()

	enriched := make([]MetadataMatch, 0, len(matches))
	for _, m := range matches {
		mu.RLock()
		if t, ok := tracks[m.TrackID]; ok {
			m.FilePath = t.FilePath
			if _, hasCover := func() ([]byte, bool) {
				coverMu.RLock()
				defer coverMu.RUnlock()
				d, e := coverCache[t.AlbumID]
				return d, e
			}(); hasCover {
				m.HasCover = true
			}
		}
		mu.RUnlock()

		if m.MBAlbumID != "" {
			coverDir := filepath.Join(musicDir, "images")
			coverPath := filepath.Join(coverDir, m.MBAlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				m.HasCover = true
			}
		}

		enriched = append(enriched, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(enriched)
}

func metadataAllHandler(w http.ResponseWriter, r *http.Request) {
	matches := dbGetAllMatches()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(matches)
}

func metadataApproveHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/approve/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !dbApproveMatch(id) {
		http.Error(w, "Match not found or not pending", http.StatusNotFound)
		return
	}

	applied := applyApprovedMatches()
	autoSortMusic()
	extractEmbeddedCovers()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"approved": true,
		"applied":  applied,
	})
}

func metadataRejectHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/reject/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !dbRejectMatch(id) {
		http.Error(w, "Match not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"rejected": true})
}

func metadataApproveAllHandler(w http.ResponseWriter, r *http.Request) {
	count := dbApproveAllMatches()
	applied := applyApprovedMatches()
	extractEmbeddedCovers()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"approved": count,
		"applied":  applied,
	})
}

func metadataClearHandler(w http.ResponseWriter, r *http.Request) {
	dbClearMatches()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"cleared": true})
}

func metadataCountsHandler(w http.ResponseWriter, r *http.Request) {
	counts := dbGetMatchCount()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

func metadataUndoHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/undo/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	trackID, ok := dbUndoMatch(id)
	if !ok {
		http.Error(w, "Match not found or not approved", http.StatusNotFound)
		return
	}

	// Restore track from file tags on next scan
	mu.Lock()
	if t, exists := tracks[trackID]; exists {
		t.HasMetadata = false
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"undone": true})
}

func spaHandler(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Path)
	if path == "/" {
		path = "/index.html"
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

func finderSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	searchType := r.URL.Query().Get("type")
	if searchType == "" {
		searchType = "recording"
	}

	if q == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	limit := 20

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	switch searchType {
	case "recording":
		results, err := finderSearchRecordings(q, limit)
		if err != nil {
			log.Printf("[finder] Recording search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []FinderRecording{}
		}
		json.NewEncoder(w).Encode(results)

	case "artist":
		results, err := finderSearchArtists(q, limit)
		if err != nil {
			log.Printf("[finder] Artist search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []FinderArtist{}
		}
		json.NewEncoder(w).Encode(results)

	case "release":
		results, err := finderSearchReleases(q, limit)
		if err != nil {
			log.Printf("[finder] Release search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []FinderRelease{}
		}
		json.NewEncoder(w).Encode(results)

	default:
		http.Error(w, `{"error":"invalid type"}`, http.StatusBadRequest)
	}
}

func finderArtistReleasesHandler(w http.ResponseWriter, r *http.Request) {
	mbid := strings.TrimPrefix(r.URL.Path, "/api/finder/artist/")
	mbid = strings.TrimSuffix(mbid, "/releases")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	results, err := finderArtistReleases(mbid)
	if err != nil {
		log.Printf("[finder] Artist releases error: %v", err)
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []FinderRelease{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(results)
}

func finderReleaseTracksHandler(w http.ResponseWriter, r *http.Request) {
	mbid := strings.TrimPrefix(r.URL.Path, "/api/finder/release/")
	mbid = strings.TrimSuffix(mbid, "/tracks")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	results, err := finderReleaseTracks(mbid)
	if err != nil {
		log.Printf("[finder] Release tracks error: %v", err)
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []FinderReleaseTrack{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(results)
}

func finderCoverHandler(w http.ResponseWriter, r *http.Request) {
	mbid := strings.TrimPrefix(r.URL.Path, "/api/finder/cover/")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	coverURL := fmt.Sprintf("%s/release-group/%s/front-250", coverArtBaseURL, mbid)
	req, err := http.NewRequest("GET", coverURL, nil)
	if err != nil {
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		coverURL = fmt.Sprintf("%s/release/%s/front-250", coverArtBaseURL, mbid)
		req, _ = http.NewRequest("GET", coverURL, nil)
		req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")
		resp, err = mbClient.Do(req)
		if err != nil || resp.StatusCode != 200 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, resp.Body)
}

func downloadQueueHandler(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}

	jobs, err := dbGetJobs(limit)
	if err != nil {
		http.Error(w, `{"error":"failed to load jobs"}`, http.StatusInternalServerError)
		return
	}
	if jobs == nil {
		jobs = []DownloadJob{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func downloadQueueAddHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Query      string `json:"query"`
		Artist     string `json:"artist"`
		Title      string `json:"title"`
		Album      string `json:"album"`
		AlbumMBID  string `json:"albumMbid"`
		TrackNum   int    `json:"trackNumber"`
		TrackTotal int    `json:"trackTotal"`
		OverrideDir string `json:"overrideDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	job, err := createDownloadJob(
		req.Query, req.Artist, req.Title, req.Album,
		req.AlbumMBID, req.TrackNum, req.TrackTotal, req.OverrideDir, "",
	)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadQueueAddBatchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Tracks []struct {
			Artist     string `json:"artist"`
			Title      string `json:"title"`
			Album      string `json:"album"`
			AlbumMBID  string `json:"albumMbid"`
			TrackNum   int    `json:"trackNumber"`
			TrackTotal int    `json:"trackTotal"`
		} `json:"tracks"`
		OverrideDir string `json:"overrideDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	var jobs []*DownloadJob
	for _, t := range req.Tracks {
		query := ""
		if t.Artist != "" && t.Title != "" {
			query = t.Artist + " - " + t.Title
		} else if t.Title != "" {
			query = t.Title
		}

		job, err := createDownloadJob(
			query, t.Artist, t.Title, t.Album,
			t.AlbumMBID, t.TrackNum, t.TrackTotal, req.OverrideDir, "",
		)
		if err != nil {
			log.Printf("[download] Failed to create job for %q: %v", query, err)
			continue
		}
		jobs = append(jobs, job)
		time.Sleep(100 * time.Millisecond)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func downloadJobStatusHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadJobRetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	id = strings.TrimSuffix(id, "/retry")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	job.Status = "queued"
	job.Error = ""
	job.ProgressStage = ""
	job.CompletedAt = ""
	dbUpdateJob(job)

	go processDownloadQueue()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadJobDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" && r.Method != "DELETE" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	id = strings.TrimSuffix(id, "/delete")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	db.Exec("DELETE FROM download_jobs WHERE id = ?", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func queueClearCompletedHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	result, err := db.Exec("DELETE FROM download_jobs WHERE status IN ('completed', 'failed')")
	cleared := 0
	if err == nil {
		affected, _ := result.RowsAffected()
		cleared = int(affected)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"cleared": cleared})
}

func settingsGetHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getAllSettings())
}

func settingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	for k, v := range settings {
		setSetting(k, v)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func queueCountsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dbGetJobCounts())
}

func bulkImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Lines       string `json:"lines"`
		OverrideDir string `json:"overrideDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	var jobs []string
	for _, line := range strings.Split(req.Lines, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		artist, title := "", line
		if idx := strings.Index(line, " - "); idx > 0 {
			artist = strings.TrimSpace(line[:idx])
			title = strings.TrimSpace(line[idx+3:])
		}

		job, err := createDownloadJob("", artist, title, "", "", 0, 0, req.OverrideDir, "")
		if err != nil {
			log.Printf("[bulk] Skipped %q: %v", line, err)
			continue
		}
		jobs = append(jobs, job.ID)
		time.Sleep(100 * time.Millisecond)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"queued": len(jobs), "ids": jobs})
}

func playlistImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
		return
	}

	name, ytTracks, err := extractYouTubePlaylistTracks(req.URL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	libraryPlaylistID := dbGetOrCreatePlaylistByName(name)

	wp := &WatchedPlaylist{
		ID:        uuid.New().String()[:8],
		URL:       req.URL,
		Name:      name,
		TrackCount: len(ytTracks),
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	db.Exec(`INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		wp.ID, wp.URL, wp.Name, wp.TrackCount, wp.CreatedAt, wp.CreatedAt)

	queued := 0
	for _, t := range ytTracks {
		artist, title, videoID := t.Artist, t.Title, t.VideoID
		inLib := checkDuplicateInLibrary(artist, title)

		status := "pending"
		if inLib {
			status = "completed"
			mu.RLock()
			for _, tr := range tracks {
				if strings.EqualFold(tr.Artist, artist) && strings.EqualFold(tr.Title, title) {
					dbAddTrackToPlaylist(libraryPlaylistID, tr.ID)
					break
				}
			}
			mu.RUnlock()
		}

		db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, video_id, artist, title, status) VALUES (?, ?, ?, ?, ?)",
			wp.ID, videoID, artist, title, status)

		if !inLib {
			job, _ := createDownloadJob("", artist, title, "", "", 0, 0, "", videoID)
			if job != nil {
				job.PlaylistID = libraryPlaylistID
				db.Exec("UPDATE download_jobs SET playlist_id = ? WHERE id = ?", libraryPlaylistID, job.ID)
			}
			queued++
			time.Sleep(100 * time.Millisecond)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":        wp.ID,
		"name":      name,
		"total":     len(ytTracks),
		"queued":    queued,
		"inLibrary": len(ytTracks) - queued,
	})
}

func watchedPlaylistsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
			return
		}

		name, _, err := extractYouTubePlaylistTracks(req.URL)
		if err != nil {
			http.Error(w, `{"error":"could not fetch playlist"}`, http.StatusBadRequest)
			return
		}

		wp := &WatchedPlaylist{
			ID:        uuid.New().String()[:8],
			URL:       req.URL,
			Name:      name,
			CreatedAt: time.Now().Format(time.RFC3339),
		}
		db.Exec("INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, 0, ?, ?)",
			wp.ID, wp.URL, wp.Name, wp.CreatedAt, wp.CreatedAt)

		go refreshWatchedPlaylist(wp)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":        wp.ID,
			"name":      name,
			"url":       wp.URL,
			"total":     0,
			"queued":    0,
			"trackCount": 0,
		})
		return
	}

	if strings.HasSuffix(r.URL.Path, "/refresh") {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		id = strings.TrimSuffix(id, "/refresh")
		if id != "" {
			var wp WatchedPlaylist
			row := db.QueryRow("SELECT id, url, name, track_count, last_refresh, created_at FROM watched_playlists WHERE id = ?", id)
			row.Scan(&wp.ID, &wp.URL, &wp.Name, &wp.TrackCount, &wp.LastRefresh, &wp.CreatedAt)
			if wp.ID != "" {
				go refreshWatchedPlaylist(&wp)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	if r.Method == "DELETE" {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		db.Exec("DELETE FROM watched_playlist_tracks WHERE playlist_id = ?", id)
		db.Exec("DELETE FROM watched_playlists WHERE id = ?", id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	playlists, err := dbGetWatchedPlaylists()
	if err != nil {
		playlists = []WatchedPlaylist{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(playlists)
}

func checkDuplicateInLibrary(artist, title string) bool {
	mu.RLock()
	defer mu.RUnlock()
	for _, t := range tracks {
		if strings.EqualFold(t.Artist, artist) && strings.EqualFold(t.Title, title) {
			return true
		}
	}
	return false
}

type youtubeSearchResult struct {
	VideoID  string `json:"videoId"`
	Title    string `json:"title"`
	Channel  string `json:"channel"`
	Duration int    `json:"duration"`
	InLibrary bool  `json:"inLibrary"`
}

func youtubeSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytsearch10:%s", q),
	)
	output, err := cmd.Output()
	if err != nil {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	var results []youtubeSearchResult
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Channel  string `json:"channel"`
			Duration float64 `json:"duration"`
		}
		if json.Unmarshal([]byte(line), &entry) != nil || entry.ID == "" || entry.Duration < 10 {
			continue
		}

		artist := entry.Channel
		title := entry.Title
		if idx := strings.Index(title, " - "); idx > 0 {
			a := strings.TrimSpace(title[:idx])
			t := strings.TrimSpace(title[idx+3:])
			if a != "" && t != "" {
				artist = a
				title = t
			}
		}

		inLib := checkDuplicateInLibrary(artist, title)

		results = append(results, youtubeSearchResult{
			VideoID:  entry.ID,
			Title:    title,
			Channel:  artist,
			Duration: int(entry.Duration),
			InLibrary: inLib,
		})
	}

	if results == nil {
		results = []youtubeSearchResult{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func previewAudioHandler(w http.ResponseWriter, r *http.Request) {
	videoID := strings.TrimPrefix(r.URL.Path, "/api/preview/")
	if videoID == "" {
		http.Error(w, `{"error":"missing video id"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not available"}`, http.StatusServiceUnavailable)
		return
	}

	cmd := exec.Command(ytdlpPath,
		"-f", "bestaudio[protocol=https]/bestaudio/best",
		"-g", "--no-warnings",
		fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID),
	)
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, `{"error":"could not resolve stream"}`, http.StatusInternalServerError)
		return
	}

	streamURL := strings.TrimSpace(strings.Split(string(output), "\n")[0])
	if streamURL == "" {
		http.Error(w, `{"error":"no stream url"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": streamURL, "videoId": videoID})
}

func downloadJobFileHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/download-job/")
	if id == "" {
		http.Error(w, "missing job id", http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil || job.FilePath == "" {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(job.FilePath)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer f.Close()

	stat, _ := f.Stat()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(job.FilePath)))
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	io.Copy(w, f)
}
