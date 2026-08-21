package handlers

import (
	"fmt"
	"hash/fnv"
	"io"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dhowden/tag"
)

func StreamHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/stream/")

	store.Mu.RLock()
	track, exists := store.Tracks[id]
	store.Mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	fullPath := scanner.ResolveFilePath(track.FilePath)

	ext := strings.ToLower(filepath.Ext(fullPath))
	contentType := store.AudioExtensions[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	servePath := fullPath
	serveType := contentType

	// fmt=aac: clients that can't stream FLAC/Opus/Ogg/WAV (iOS/macOS Safari)
	// request a transcoded copy. Cached .m4a is served Range-seekable exactly
	// like a raw file; on any transcode failure we fall back to the original
	// (graceful degradation — same behavior as before the feature).
	// ALAC exception: browsers claim .m4a support (canPlayType) but can't
	// decode Apple Lossless, so the server forces the transcode path for
	// ALAC files regardless of the fmt param.
	forced := ext == ".m4a" && transcode.IsALAC(fullPath)
	if (r.URL.Query().Get("fmt") == "aac" || forced) &&
		store.GetSettingBool("transcode_enabled", true) &&
		(needsTranscode(ext) || forced) {
		if cp, err := transcode.Ensure(id, fullPath); err == nil {
			servePath = cp
			serveType = "audio/mp4"
		}
	}

	serveRangeable(w, r, servePath, serveType)
}

// serveRangeable streams a file with HTTP Range support, serving either a
// partial or full response. Shared by raw-file and transcoded-cache paths so
// both behave identically for audio clients.
func serveRangeable(w http.ResponseWriter, r *http.Request, path, contentType string) {
	file, err := os.Open(path)
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

	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		start, end, ok := parseByteRange(rangeHeader, fileSize)
		if !ok {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		if _, err := file.Seek(start, io.SeekStart); err != nil {
			http.Error(w, "Could not seek file", http.StatusInternalServerError)
			return
		}

		contentLength := end - start + 1
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

// parseByteRange parses the single byte-range form used by audio clients.
// It supports explicit, open-ended, and suffix ranges (for example bytes=-500).
func parseByteRange(header string, fileSize int64) (start, end int64, ok bool) {
	if fileSize <= 0 || !strings.HasPrefix(header, "bytes=") {
		return 0, 0, false
	}

	rangeSpec := strings.TrimPrefix(header, "bytes=")
	startText, endText, found := strings.Cut(rangeSpec, "-")
	if !found || (startText == "" && endText == "") || strings.Contains(endText, ",") {
		return 0, 0, false
	}

	if startText == "" {
		suffixLength, err := strconv.ParseInt(endText, 10, 64)
		if err != nil || suffixLength <= 0 {
			return 0, 0, false
		}
		if suffixLength > fileSize {
			suffixLength = fileSize
		}
		return fileSize - suffixLength, fileSize - 1, true
	}

	start, err := strconv.ParseInt(startText, 10, 64)
	if err != nil || start < 0 || start >= fileSize {
		return 0, 0, false
	}
	if endText == "" {
		return start, fileSize - 1, true
	}

	end, err = strconv.ParseInt(endText, 10, 64)
	if err != nil || end < start {
		return 0, 0, false
	}
	if end >= fileSize {
		end = fileSize - 1
	}
	return start, end, true
}

// serveCoverBytes writes cover bytes with revalidation: `no-cache` (every
// visit re-checks) + an ETag over the content, so unchanged covers come back
// as cheap 304s instead of full re-downloads, and changed art is picked up
// immediately. Bumping the etag scheme invalidates old cached placeholders.
func serveCoverBytes(w http.ResponseWriter, r *http.Request, data []byte, contentType string) {
	h := fnv.New32a()
	h.Write(data)
	etag := fmt.Sprintf(`"c2-%x"`, h.Sum32())
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(data)
}

func CoverHandler(w http.ResponseWriter, r *http.Request) {
	albumID := strings.TrimPrefix(r.URL.Path, "/api/cover/")
	if strings.ContainsAny(albumID, `/\`) || strings.Contains(albumID, "..") {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	store.CoverMu.RLock()
	data, exists := store.CoverCache[albumID]
	store.CoverMu.RUnlock()

	if exists {
		contentType := http.DetectContentType(data)
		if strings.HasPrefix(contentType, "application/") || strings.HasPrefix(contentType, "text/") {
			contentType = "image/jpeg"
		}
		serveCoverBytes(w, r, data, contentType)
		return
	}

	coverPath := filepath.Join(store.MusicDir, "images", albumID+".jpg")
	if diskData, err := os.ReadFile(coverPath); err == nil {
		store.CacheCover(albumID, diskData)
		serveCoverBytes(w, r, diskData, "image/jpeg")
		return
	}

	store.Mu.RLock()
	album, ok := store.Albums[albumID]
	store.Mu.RUnlock()
	var albumName string
	if ok {
		albumName = album.Name
	}

	svg := scanner.GeneratePlaceholderSVG(albumName, albumID)
	serveCoverBytes(w, r, []byte(svg), "image/svg+xml")
}

func ArtistArtHandler(w http.ResponseWriter, r *http.Request) {
	artistName := strings.TrimPrefix(r.URL.Path, "/api/artist-art/")
	if artistName == "" {
		http.Error(w, "Artist name required", http.StatusBadRequest)
		return
	}
	if strings.ContainsAny(artistName, `/\`) || strings.Contains(artistName, "..") {
		http.Error(w, `{"error":"invalid artist name"}`, http.StatusBadRequest)
		return
	}

	key := strings.ToLower(strings.TrimSpace(artistName))

	musicbrainz.ArtistArtMu.RLock()
	data, exists := musicbrainz.ArtistArtCache[key]
	musicbrainz.ArtistArtMu.RUnlock()

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

	artDir := filepath.Join(store.MusicDir, "images", "artists")
	artFile := filepath.Join(artDir, key+".jpg")
	if diskData, err := os.ReadFile(artFile); err == nil && len(diskData) > 0 {
		musicbrainz.ArtistArtMu.Lock()
		musicbrainz.ArtistArtCache[key] = diskData
		musicbrainz.ArtistArtMu.Unlock()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(diskData)
		return
	}

	// Fallback: use first album cover for this artist
	store.Mu.RLock()
	for _, a := range store.Albums {
		if a.Artist == "" || strings.ToLower(strings.TrimSpace(a.Artist)) != key {
			continue
		}
		if !a.HasCover {
			continue
		}
		coverPath := filepath.Join(store.MusicDir, "images", a.ID+".jpg")
		if coverData, err := os.ReadFile(coverPath); err == nil {
			store.Mu.RUnlock()
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			w.Write(coverData)
			return
		}
	}
	store.Mu.RUnlock()

	svg := scanner.GeneratePlaceholderSVG(artistName, artistName)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write([]byte(svg))
}

func ArtistArtFetchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	artistName := strings.TrimPrefix(r.URL.Path, "/api/artist-art-fetch/")
	if artistName == "" {
		http.Error(w, "Artist name required", http.StatusBadRequest)
		return
	}

	fetched := musicbrainz.FetchArtistImage(artistName)

	writeJSON(w, map[string]bool{"fetched": fetched})
}

func extractCoverFromFile(filePath string) ([]byte, error) {
	fullPath := scanner.ResolveFilePath(filePath)
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
