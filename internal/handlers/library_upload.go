package handlers

import (
	"encoding/json"
	"io"
	"log"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const libraryUploadMaxBytes = 8 * 1024 * 1024 * 1024

func LibraryUploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, libraryUploadMaxBytes)
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		http.Error(w, "Upload too large or invalid", http.StatusRequestEntityTooLarge)
		return
	}

	var uploaded []string
	var uploadErrors []string

	formFiles := r.MultipartForm.File["files"]
	for _, fh := range formFiles {
		rel, ok := sanitizeUploadPath(fh.Filename)
		if !ok {
			uploadErrors = append(uploadErrors, fh.Filename+": invalid path")
			continue
		}

		ext := strings.ToLower(filepath.Ext(rel))
		if _, ok := store.AudioExtensions[ext]; !ok {
			uploadErrors = append(uploadErrors, fh.Filename+": not an audio file")
			continue
		}

		dstPath := filepath.Join(store.MusicDir, rel)
		dstPath = filepath.Clean(dstPath)
		if !strings.HasPrefix(dstPath, store.MusicDir+string(os.PathSeparator)) {
			uploadErrors = append(uploadErrors, fh.Filename+": invalid path")
			continue
		}

		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": could not create directory")
			continue
		}

		src, err := fh.Open()
		if err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": could not read file")
			continue
		}

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

		uploaded = append(uploaded, rel)
	}

	if len(uploaded) > 0 {
		log.Printf("[upload] Library upload: %d file(s) saved, %d error(s)", len(uploaded), len(uploadErrors))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"uploaded": uploaded,
		"errors":   uploadErrors,
	})
}

func sanitizeUploadPath(rel string) (string, bool) {
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "" || rel == "." || rel == "/" {
		return "", false
	}
	if strings.HasPrefix(rel, "/") {
		return "", false
	}
	for _, p := range strings.Split(rel, "/") {
		if p == "" || p == ".." || p == "." {
			return "", false
		}
	}
	return rel, true
}
