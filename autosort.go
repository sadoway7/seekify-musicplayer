package main

import (
	"log"
	"musicapp/internal/store"
	"os"
	"path/filepath"
	"strings"
)

func autoSortMusic() {
	store.Mu.RLock()
	type moveJob struct {
		src string
		dst string
	}
	var jobs []moveJob

	for _, t := range store.Tracks {
		if t.Artist == "" || t.Title == "" {
			continue
		}

		// Only auto-sort files in the primary musicDir
		// (media dir is read-only, no prefix in FilePath means primary dir)
		if musicDirForPath(t.FilePath) != store.MusicDir {
			continue
		}

		expectedDir := filepath.Join(store.MusicDir, sanitizePath(t.Artist))
		if t.Album != "" {
			expectedDir = filepath.Join(expectedDir, sanitizePath(t.Album))
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

		jobs = append(jobs, moveJob{src: currentPath, dst: expectedPath})
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
		moved++
	}

	if moved > 0 {
		log.Printf("Auto-sorted %d files. Re-scanning...", moved)
		scanMusicDir(store.MusicDir)
	}
}

func sanitizePath(name string) string {
	name = strings.TrimSpace(name)
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "",
		"?", "",
		"<", "",
		">", "",
		"|", "",
		"\"", "'",
	)
	return replacer.Replace(name)
}
