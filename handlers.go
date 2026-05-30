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
	"time"
)

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

	fullPath := filepath.Join(musicDir, track.FilePath)
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

	mu.RLock()
	var albumName string
	for _, a := range albums {
		if a.ID == albumID {
			albumName = a.Name
			break
		}
	}
	mu.RUnlock()

	svg := generatePlaceholderSVG(albumName)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write([]byte(svg))
}

func scanHandler(w http.ResponseWriter, r *http.Request) {
	stats := scanMusicDir(musicDir)
	applyApprovedMatches()
	autoSortMusic()
	extractEmbeddedCovers()
	log.Printf("Scan complete: %d scanned, %d added, %d removed", stats.Scanned, stats.Added, stats.Removed)

	go fetchMissingCovers()

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
	trackID := strings.TrimPrefix(r.URL.Path, "/api/favorites/")
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

func adminHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	http.ServeFile(w, r, "admin.html")
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

func metadataScanHandler(w http.ResponseWriter, r *http.Request) {
	metaScanLock.Lock()
	if metaScan.Running {
		metaScanLock.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "already_running",
			"progress": metaScan.Scanned,
			"total":    metaScan.Total,
		})
		return
	}
	metaScanLock.Unlock()

	go scanMetadataForTracks()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "started",
	})
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
	autoSortMusic()

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
