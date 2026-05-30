package main

import (
	"crypto/sha256"
	"fmt"
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
)

func titleFromFilename(path string) string {
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext)
}

func scanMusicDir(dir string) ScanStats {
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
	log.Printf("Found %d audio files", len(files))

	for _, fpath := range files {
		relPath, err := filepath.Rel(dir, fpath)
		if err != nil {
			relPath = fpath
		}

		trackID := generateID(relPath)

		parts := strings.Split(relPath, string(filepath.Separator))
		folderArtist := ""
		folderAlbum := ""
		if len(parts) >= 3 {
			folderArtist = parts[0]
			folderAlbum = parts[1]
		} else if len(parts) == 2 {
			folderAlbum = parts[0]
		}

		file, err := os.Open(fpath)
		if err != nil {
			log.Printf("Error opening %s: %v", fpath, err)
			continue
		}

		tagReader, err := tag.ReadFrom(file)
		file.Close()

		track := &Track{
			ID:       trackID,
			FilePath: relPath,
			Duration: 0,
		}

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
		} else {
			log.Printf("Could not read tags from %s: %v", fpath, err)
		}

		if track.Title == "" {
			track.Title = titleFromFilename(fpath)
		}
		if track.Artist == "" {
			if folderArtist != "" {
				track.Artist = folderArtist
			}
		}
		if track.Album == "" {
			if folderAlbum != "" {
				track.Album = folderAlbum
			}
		}
		if track.AlbumArtist == "" {
			track.AlbumArtist = track.Artist
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
					if pic != nil {
						newCovers[albumID] = pic.Data
						newAlbums[albumID].HasCover = true
					}
				}
			}
		}
	}

	mu.Lock()
	oldTrackCount := len(tracks)
	tracks = newTracks
	albums = newAlbums
	mu.Unlock()

	coverMu.Lock()
	coverCache = newCovers
	coverMu.Unlock()

	stats.Added = len(newTracks) - oldTrackCount
	if stats.Added < 0 {
		stats.Removed = -stats.Added
		stats.Added = 0
	} else {
		stats.Removed = 0
	}

	return stats
}

func generatePlaceholderSVG(name string) string {
	h := sha256.Sum256([]byte(name))
	r := int(h[0]) % 128 + 80
	g := int(h[1]) % 128 + 80
	b := int(h[2]) % 128 + 80

	initial := "?"
	if len(name) > 0 {
		initial = strings.ToUpper(string(name[0]))
	}

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect width="300" height="300" fill="rgb(%d,%d,%d)"/>
  <text x="150" y="160" font-family="sans-serif" font-size="120" font-weight="bold" fill="rgba(255,255,255,0.7)" text-anchor="middle" dominant-baseline="middle">%s</text>
</svg>`, r, g, b, initial)
}
