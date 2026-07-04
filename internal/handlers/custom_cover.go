package handlers

import (
	"io"
	"log"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func UploadCustomCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 20*1024*1024)
	if err := r.ParseMultipartForm(20 * 1024 * 1024); err != nil {
		http.Error(w, "Image too large (max 20MB) or invalid upload", http.StatusRequestEntityTooLarge)
		return
	}

	trackID := r.FormValue("trackId")
	if trackID == "" {
		http.Error(w, "trackId required", http.StatusBadRequest)
		return
	}

	albumID, ok := store.AlbumIDForTrack(trackID)
	if !ok {
		http.Error(w, "Track or album not found", http.StatusNotFound)
		return
	}

	file, _, err := r.FormFile("cover")
	if err != nil {
		http.Error(w, "cover file required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 20*1024*1024))
	if err != nil || len(data) == 0 {
		http.Error(w, "Could not read image", http.StatusBadRequest)
		return
	}

	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		http.Error(w, "File is not an image", http.StatusBadRequest)
		return
	}

	coverDir := filepath.Join(store.MusicDir, "images")
	if err := os.MkdirAll(coverDir, 0755); err != nil {
		http.Error(w, "Could not create cover directory", http.StatusInternalServerError)
		return
	}

	coverPath := filepath.Join(coverDir, albumID+".jpg")
	if err := os.WriteFile(coverPath, data, 0644); err != nil {
		http.Error(w, "Could not save cover", http.StatusInternalServerError)
		return
	}

	store.RemoveCover(albumID)
	store.CacheCover(albumID, data)

	store.Mu.Lock()
	if t, ok := store.Tracks[trackID]; ok {
		t.HasCover = true
	}
	if a, ok := store.Albums[albumID]; ok {
		a.HasCover = true
	}
	store.Mu.Unlock()

	store.SetCustomCover(albumID)

	LibraryVersion.Add(1)

	log.Printf("[cover] Custom cover uploaded for album %s (%d bytes)", albumID, len(data))

	writeJSON(w, map[string]string{"updated": "true", "albumId": albumID})
}

func ClearCustomCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trackID := r.URL.Query().Get("trackId")
	if trackID == "" {
		http.Error(w, "trackId required", http.StatusBadRequest)
		return
	}

	albumID, ok := store.AlbumIDForTrack(trackID)
	if !ok {
		http.Error(w, "Track or album not found", http.StatusNotFound)
		return
	}

	if !store.IsCustomCover(albumID) {
		writeJSON(w, map[string]bool{"cleared": false})
		return
	}

	store.ClearCustomCover(albumID)

	coverPath := filepath.Join(store.MusicDir, "images", albumID+".jpg")
	os.Remove(coverPath)

	store.RemoveCover(albumID)

	scanner.ExtractEmbeddedCovers()

	LibraryVersion.Add(1)

	log.Printf("[cover] Custom cover cleared for album %s", albumID)

	writeJSON(w, map[string]bool{"cleared": true})
}
