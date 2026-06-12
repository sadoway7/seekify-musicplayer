package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dhowden/tag"
)

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

func extractCoverFromFile(filePath string) ([]byte, error) {
	fullPath := resolveFilePath(filePath)
	f, err := os.Open(fullPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	tagReader, err := tag.ReadFrom(f)
	if err != nil || tagReader == nil {
		return nil, fmt.Errorf("no tags")
	}
	pic := tagReader.Picture()
	if pic == nil || len(pic.Data) == 0 {
		return nil, fmt.Errorf("no picture")
	}
	return pic.Data, nil
}
