package scanner

import (
	"log"
	"musicapp/internal/models"
	"musicapp/internal/store"
	"os"
	"path/filepath"
	"strings"
)

func AutoSortMusic() {
	store.Mu.RLock()
	type moveJob struct {
		src      string
		dst      string
		oldID    string
		newID    string
		newRelPath string
	}
	var jobs []moveJob

	for _, t := range store.Tracks {
		if t.Artist == "" || t.Title == "" {
			continue
		}

		// Only auto-sort files in the primary musicDir
		if MusicDirForPath(t.FilePath) != store.MusicDir {
			continue
		}

		expectedDir := filepath.Join(store.MusicDir, SanitizePath(t.Artist))
		if t.Album != "" {
			expectedDir = filepath.Join(expectedDir, SanitizePath(t.Album))
		}
		expectedPath := filepath.Join(expectedDir, filepath.Base(t.FilePath))
		currentPath := filepath.Join(store.MusicDir, t.FilePath)

		currentPath = filepath.Clean(currentPath)
		expectedPath = filepath.Clean(expectedPath)

		if currentPath == expectedPath {
			continue
		}

		if _, err := os.Stat(currentPath); os.IsNotExist(err) {
			continue
		}

		newRelPath := strings.TrimPrefix(expectedPath, store.MusicDir+string(filepath.Separator))
		newID := models.GenerateID(newRelPath)

		jobs = append(jobs, moveJob{
			src:        currentPath,
			dst:        expectedPath,
			oldID:      t.ID,
			newID:      newID,
			newRelPath: newRelPath,
		})
	}
	store.Mu.RUnlock()

	if len(jobs) == 0 {
		return
	}

	log.Printf("Auto-sorting %d files into Artist/Album structure...", len(jobs))

	moved := 0
	for _, job := range jobs {
		os.MkdirAll(filepath.Dir(job.dst), 0755)

		if err := os.Rename(job.src, job.dst); err != nil {
			log.Printf("Failed to move %s -> %s: %v", job.src, job.dst, err)
			continue
		}

		// Migrate track ID AFTER successful rename so a failed move
		// doesn't orphan favorites/playlists/reviews.
		if job.oldID != job.newID {
			store.DbMigrateTrackID(job.oldID, job.newID, job.newRelPath)
		}

		// Update in-memory map immediately so the old path isn't served
		// (404) between the rename and the rescan.
		store.Mu.Lock()
		if old, ok := store.Tracks[job.oldID]; ok {
			deleted := old
			deleted.FilePath = job.newRelPath
			deleted.ID = job.newID
			delete(store.Tracks, job.oldID)
			store.Tracks[job.newID] = deleted
		}
		store.Mu.Unlock()

		moved++
	}

	if moved > 0 {
		log.Printf("Auto-sorted %d files. Re-scanning...", moved)
		ScanMusicDir(store.MusicDir)
	}
}

func SanitizePath(name string) string {
	name = strings.TrimSpace(name)
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, ch := range invalid {
		name = strings.ReplaceAll(name, ch, "_")
	}
	name = strings.TrimSpace(name)
	for strings.HasSuffix(name, ".") {
		name = name[:len(name)-1]
	}
	return name
}
