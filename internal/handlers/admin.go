package handlers

import (
	"encoding/json"
	"io"
	"musicapp/internal/auth"
	"musicapp/internal/store"
	"musicapp/internal/waveform"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// RequireAdmin gates an endpoint to admin-role users. Delegates to the auth
// package so the many handlers.RequireAdmin(...) call sites in server.go keep
// working after the passcode gate was retired.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return auth.RequireAdmin(next)
}

func AdminHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	http.ServeFile(w, r, "admin.html")
}

// pathWithinRoot resolves path elements beneath root and reports whether the
// result is root itself or one of its descendants. filepath.Rel avoids the
// false positives of string-prefix checks (for example, /music-old vs /music).
func pathWithinRoot(root string, elem ...string) (string, bool) {
	root = filepath.Clean(root)
	parts := make([]string, 0, len(elem)+1)
	parts = append(parts, root)
	parts = append(parts, elem...)
	target := filepath.Clean(filepath.Join(parts...))

	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return target, true
}

func FileListHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")

	dirPath, ok := pathWithinRoot(store.MusicDir, subPath)
	if !ok {
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
			if _, ok := store.AudioExtensions[ext]; ok {
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

	writeJSON(w, result)
}

func UploadHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500*1024*1024)

	if err := r.ParseMultipartForm(500 * 1024 * 1024); err != nil {
		http.Error(w, "Upload too large", http.StatusRequestEntityTooLarge)
		return
	}

	subPath := r.FormValue("path")
	targetDir, ok := pathWithinRoot(store.MusicDir, subPath)
	if !ok {
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
		if _, ok := store.AudioExtensions[ext]; !ok {
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

	writeJSON(w, map[string]interface{}{
		"uploaded": uploaded,
		"errors":   uploadErrors,
	})
}

func DeleteFileHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")
	fullPath, ok := pathWithinRoot(store.MusicDir, subPath)
	if !ok || fullPath == filepath.Clean(store.MusicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.Remove(fullPath); err != nil {
		http.Error(w, "Could not delete file", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"deleted": true})
}

func CreateFolderHandler(w http.ResponseWriter, r *http.Request) {
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

	targetPath, ok := pathWithinRoot(store.MusicDir, body.Path, body.Name)
	if !ok {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(targetPath, 0755); err != nil {
		http.Error(w, "Could not create folder", http.StatusInternalServerError)
		return
	}

	relPath := filepath.Join(body.Path, body.Name)

	writeJSON(w, map[string]interface{}{
		"created": true,
		"path":    relPath,
	})
}

func TrackDurationHandler(w http.ResponseWriter, r *http.Request) {
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

	store.Mu.Lock()
	updated := false
	if t, ok := store.Tracks[trackID]; ok {
		if t.Duration == 0 {
			t.Duration = body.Duration
			store.DB.Exec("UPDATE tracks SET duration = ? WHERE id = ?", body.Duration, trackID)
			updated = true
		}
	}
	store.Mu.Unlock()

	writeJSON(w, map[string]bool{"updated": updated})
}

func WaveformHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/waveform/")
	if trackID == "" {
		http.Error(w, `{"error":"missing track id"}`, http.StatusBadRequest)
		return
	}

	peaks, err := waveform.GetCachedWaveform(trackID)
	if err == nil && peaks != nil {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		writeJSON(w, map[string]interface{}{"peaks": peaks})
		return
	}

	waveform.GenerateAsync(trackID)

	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, map[string]interface{}{"peaks": []float64{}, "pending": true})
}
