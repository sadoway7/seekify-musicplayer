package main

import (
	"fmt"
	"hash/fnv"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/dhowden/tag"
)

var (
	audioExtensions = map[string]string{
		".mp3":  "audio/mpeg",
		".flac": "audio/flac",
		".m4a":  "audio/mp4",
		".aac":  "audio/aac",
		".ogg":  "audio/ogg",
		".wav":  "audio/wav",
		".opus": "audio/opus",
		".wma":  "audio/x-ms-wma",
	}

	tracks     map[string]*Track
	albums     map[string]*Album
	mu         sync.RWMutex
	coverCache map[string][]byte
	coverMu    sync.RWMutex
	musicDir   string
	statePath  string

	// musicDirs maps a prefix to an absolute directory path.
	// The primary musicDir has prefix "" (empty string).
	// Additional directories use prefixes like "media".
	musicDirs map[string]string
)

// resolveFilePath expands a prefixed FilePath into an absolute path on disk.
// If filePath contains a known prefix like "media:", it resolves against that dir.
// Otherwise it resolves against the primary musicDir.
func resolveFilePath(filePath string) string {
	for prefix, dir := range musicDirs {
		if prefix == "" {
			continue
		}
		prefixKey := prefix + ":"
		if strings.HasPrefix(filePath, prefixKey) {
			relPath := strings.TrimPrefix(filePath, prefixKey)
			return filepath.Join(dir, relPath)
		}
	}
	return filepath.Join(musicDir, filePath)
}

// musicDirForPath returns the music directory root for a given FilePath.
// Used to determine where to write images/covers for a track.
func musicDirForPath(filePath string) string {
	for prefix, dir := range musicDirs {
		if prefix == "" {
			continue
		}
		prefixKey := prefix + ":"
		if strings.HasPrefix(filePath, prefixKey) {
			return dir
		}
	}
	return musicDir
}

func titleFromFilename(path string) string {
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext)
}

func scanMusicDir(dir string) ScanStats {
	return scanMusicDirWithPrefix(dir, "")
}

func scanMusicDirWithPrefix(dir string, prefix string) ScanStats {
	var stats ScanStats

	newTracks := make(map[string]*Track)
	newAlbums := make(map[string]*Album)
	newCovers := make(map[string][]byte)

	var files []string
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if _, ok := audioExtensions[ext]; ok {
			files = append(files, path)
		}
		return nil
	})

	stats.Scanned = len(files)
	log.Printf("Found %d audio files in %s", len(files), dir)

	for _, fpath := range files {
		relPath, err := filepath.Rel(dir, fpath)
		if err != nil {
			relPath = fpath
		}

		// Prefix the stored FilePath so we can resolve it later
		storedPath := relPath
		if prefix != "" {
			storedPath = prefix + ":" + relPath
		}

		trackID := generateID(storedPath)

		parts := strings.Split(relPath, string(filepath.Separator))
		folderArtist := ""
		if len(parts) >= 3 {
			folderArtist = parts[0]
		}

		file, err := os.Open(fpath)
		if err != nil {
			log.Printf("Error opening %s: %v", fpath, err)
			continue
		}

		var modTime int64
		if fi, err := file.Stat(); err == nil {
			modTime = fi.ModTime().Unix()
		}

		tagReader, err := tag.ReadFrom(file)
		file.Close()

		track := &Track{
			ID:       trackID,
			FilePath: storedPath,
			Duration: 0,
			ModTime:  modTime,
		}

		hasRealTags := false
		if err == nil && tagReader != nil {
			track.Title = tagReader.Title()
			track.Artist = tagReader.Artist()
			track.Album = tagReader.Album()
			track.AlbumArtist = tagReader.AlbumArtist()
			track.Year = tagReader.Year()
			track.Genre = tagReader.Genre()
			trackNum, _ := tagReader.Track()
			track.TrackNumber = trackNum

			picture := tagReader.Picture()
			if picture != nil {
				track.HasCover = true
			}

			if tagReader.Title() != "" && tagReader.Title() != "Unknown" {
				hasRealTags = true
			}
		} else {
			log.Printf("Could not read tags from %s: %v", fpath, err)
		}

		if track.Title == "Unknown" || track.Title == "" {
			track.Title = titleFromFilename(fpath)
		}
		if track.Artist == "Unknown" {
			track.Artist = ""
		}
		if track.Album == "Unknown" {
			track.Album = ""
		}
		if track.Artist == "" {
			if folderArtist != "" {
				track.Artist = folderArtist
			}
		}
		if track.AlbumArtist == "" {
			track.AlbumArtist = track.Artist
		}

		if hasRealTags {
			track.HasMetadata = true
		}

		var albumID string
		if track.Album != "" {
			albumID = generateAlbumID(track.AlbumArtist, track.Album)
		} else {
			albumID = generateID("single:" + trackID)
		}
		track.AlbumID = albumID

		newTracks[trackID] = track

		if track.Album != "" {
			if _, exists := newAlbums[albumID]; !exists {
				newAlbums[albumID] = &Album{
					ID:     albumID,
					Name:   track.Album,
					Artist: track.AlbumArtist,
					Year:   track.Year,
				}
			}
			newAlbums[albumID].TrackCount++
		}

		if track.HasCover {
			file2, err := os.Open(fpath)
			if err == nil {
				tagReader2, err := tag.ReadFrom(file2)
				file2.Close()
				if err == nil && tagReader2 != nil {
					pic := tagReader2.Picture()
					if pic != nil && albumID != "" {
						newCovers[albumID] = pic.Data
						if newAlbums[albumID] == nil {
							newAlbums[albumID] = &Album{
								ID:   albumID,
								Name: track.Album,
							}
						}
						newAlbums[albumID].HasCover = true

						// Always store covers in the primary musicDir
						coverDir := filepath.Join(musicDir, "images")
						os.MkdirAll(coverDir, 0755)
						coverPath := filepath.Join(coverDir, albumID+".jpg")
						if _, err := os.Stat(coverPath); os.IsNotExist(err) {
							os.WriteFile(coverPath, pic.Data, 0644)
						}
					}
				}
			}
		}
	}

	mu.Lock()
	oldTrackCount := len(tracks)

	// Persist all scanned tracks and albums to DB
	for _, t := range newTracks {
		dbUpsertTrack(t)
	}
	for _, a := range newAlbums {
		dbUpsertAlbum(a)
	}

	if prefix == "" {
		// Primary scan: only cleanup primary-dir tracks (no prefix in FilePath)
		for oldID, oldTrack := range tracks {
			if strings.Contains(oldTrack.FilePath, ":") {
				continue
			}
			if _, exists := newTracks[oldID]; !exists {
				dbDeleteTrack(oldID)
			}
		}
		for dbID, dbTrack := range dbLoadTracks() {
			if strings.Contains(dbTrack.FilePath, ":") {
				continue
			}
			if _, exists := newTracks[dbID]; !exists {
				dbDeleteTrack(dbID)
			}
		}

		// Primary scan: replace only primary-dir entries in global maps
		// First remove old primary tracks
		for id := range tracks {
			if !strings.Contains(tracks[id].FilePath, ":") {
				delete(tracks, id)
			}
		}
		for id := range albums {
			if !strings.Contains(albums[id].ID, ":") && !strings.HasPrefix(id, "single:") {
				// keep non-primary albums only if they came from a prefixed dir
			}
		}
		// Then merge new primary tracks in
		for id, t := range newTracks {
			tracks[id] = t
		}
		for id, a := range newAlbums {
			albums[id] = a
		}
	} else {
		// Additional directory: merge into existing maps
		for id, t := range newTracks {
			tracks[id] = t
		}
		for id, a := range newAlbums {
			albums[id] = a
		}
	}
	mu.Unlock()

	coverMu.Lock()
	for id, data := range newCovers {
		coverCache[id] = data
	}
	coverMu.Unlock()

	stats.Added = len(newTracks)
	if prefix == "" {
		stats.Added = len(newTracks) - oldTrackCount
		if stats.Added < 0 {
			stats.Removed = -stats.Added
			stats.Added = 0
		} else {
			stats.Removed = 0
		}
	}

	return stats
}

func generatePlaceholderSVG(name string, id string) string {
	initial := "?"
	if len(name) > 0 {
		initial = strings.ToUpper(string(name[0]))
	}

	// Use ID (unique hash) for color so every album/artist gets a distinct color
	seed := id
	if seed == "" {
		seed = name
	}
	h := fnv.New32a()
	h.Write([]byte(seed))
	hash := h.Sum32()
	hue := hash % 360

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="bg" x1="0%%" y1="0%%" x2="100%%" y2="100%%">
      <stop offset="0%%" stop-color="hsl(%d, 35%%, 30%%)"/>
      <stop offset="100%%" stop-color="hsl(%d, 45%%, 40%%)"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bg)"/>
  <text x="150" y="158" font-family="sans-serif" font-size="80" font-weight="800" fill="hsl(%d, 55%%, 80%%)" text-anchor="middle" dominant-baseline="middle" letter-spacing="-2">%s</text>
</svg>`, hue, (hue+30)%360, hue, initial)
}

func extractEmbeddedCovers() {
	coverDir := filepath.Join(musicDir, "images")
	os.MkdirAll(coverDir, 0755)

	mu.RLock()
	type job struct {
		filePath string
		albumID  string
	}
	var jobs []job
	for _, t := range tracks {
		if !t.HasCover || t.AlbumID == "" {
			continue
		}
		coverMu.RLock()
		_, cached := coverCache[t.AlbumID]
		coverMu.RUnlock()
		if cached {
			continue
		}
		coverPath := filepath.Join(coverDir, t.AlbumID+".jpg")
		if _, err := os.Stat(coverPath); err == nil {
			data, err := os.ReadFile(coverPath)
			if err == nil {
				coverMu.Lock()
				coverCache[t.AlbumID] = data
				coverMu.Unlock()
				cached = true
				continue
			}
		}
		jobs = append(jobs, job{filePath: t.FilePath, albumID: t.AlbumID})
	}
	mu.RUnlock()

	if len(jobs) == 0 {
		return
	}

	log.Printf("Extracting embedded cover art from %d files...", len(jobs))

	saved := 0
	for _, j := range jobs {
		fullPath := resolveFilePath(j.filePath)
		f, err := os.Open(fullPath)
		if err != nil {
			continue
		}

		tagReader, err := tag.ReadFrom(f)
		f.Close()
		if err != nil || tagReader == nil {
			continue
		}

		pic := tagReader.Picture()
		if pic == nil || len(pic.Data) == 0 {
			continue
		}

		coverPath := filepath.Join(coverDir, j.albumID+".jpg")
		if err := os.WriteFile(coverPath, pic.Data, 0644); err != nil {
			continue
		}

		mu.Lock()
		if a, ok := albums[j.albumID]; ok {
			a.HasCover = true
		}
		mu.Unlock()

		saved++
	}

	log.Printf("Extracted %d covers from file tags", saved)
}
