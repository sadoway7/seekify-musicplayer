package handlers

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"musicapp/internal/models"
	"musicapp/internal/review"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
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

	var tracks []map[string]interface{}
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

		scanner.ScanSingleFile(dstPath)

		trackID := models.GenerateID(rel)
		review.DbSetReviewStatus(trackID, "reviewed_ok", "[]", "upload")
		store.Mu.Lock()
		if t, ok := store.Tracks[trackID]; ok {
			t.ReviewStatus = "reviewed_ok"
		}
		track := store.Tracks[trackID]
		store.Mu.Unlock()

		if track != nil {
			tracks = append(tracks, map[string]interface{}{
				"id":       track.ID,
				"title":    track.Title,
				"artist":   track.Artist,
				"album":    track.Album,
				"albumID":  track.AlbumID,
				"year":     track.Year,
				"hasCover": track.HasCover,
				"filePath": track.FilePath,
			})
		}

		uploaded = append(uploaded, rel)
	}

	if len(uploaded) > 0 {
		LibraryVersion.Add(1)
		log.Printf("[upload] Library add: %d file(s) added, %d error(s)", len(uploaded), len(uploadErrors))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks":   tracks,
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

func MetadataPreviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, libraryUploadMaxBytes)
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		http.Error(w, "Upload too large or invalid", http.StatusRequestEntityTooLarge)
		return
	}

	var results []map[string]interface{}

	for _, fh := range r.MultipartForm.File["files"] {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if _, ok := store.AudioExtensions[ext]; !ok {
			continue
		}

		info := map[string]interface{}{
			"filename": fh.Filename,
			"title":    "",
			"artist":   "",
			"album":    "",
			"year":     0,
			"hasCover": false,
		}

		src, err := fh.Open()
		if err != nil {
			results = append(results, info)
			continue
		}

		tagReader, err := tag.ReadFrom(src)
		src.Close()

		if err == nil && tagReader != nil {
			info["title"] = tagReader.Title()
			info["artist"] = tagReader.Artist()
			info["album"] = tagReader.Album()
			info["year"] = tagReader.Year()

			picture := tagReader.Picture()
			if picture != nil {
				info["hasCover"] = true
				mime := picture.MIMEType
				if mime == "" {
					mime = "image/jpeg"
				}
				encoded := base64.StdEncoding.EncodeToString(picture.Data)
				info["cover"] = "data:" + mime + ";base64," + encoded
			}
		}

		if info["title"] == "" || info["title"] == "Unknown" {
			name := fh.Filename
			if idx := strings.LastIndex(name, "."); idx > 0 {
				name = name[:idx]
			}
			info["title"] = name
		}
		if info["artist"] == "Unknown" {
			info["artist"] = ""
		}
		if info["album"] == "Unknown" {
			info["album"] = ""
		}

		results = append(results, info)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks": results,
	})
}
