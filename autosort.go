package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

func autoSortMusic() {
	mu.RLock()
	type moveJob struct {
		src string
		dst string
	}
	var jobs []moveJob

	for _, t := range tracks {
		if t.Artist == "" || t.Title == "" {
			continue
		}

		// Only auto-sort files in the primary musicDir
		// (media dir is read-only, no prefix in FilePath means primary dir)
		if musicDirForPath(t.FilePath) != musicDir {
			continue
		}

		expectedDir := filepath.Join(musicDir, sanitizePath(t.Artist))
		if t.Album != "" {
			expectedDir = filepath.Join(expectedDir, sanitizePath(t.Album))
		}
		expectedPath := filepath.Join(expectedDir, filepath.Base(t.FilePath))
		currentPath := filepath.Join(musicDir, t.FilePath)

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
	mu.RUnlock()

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
		scanMusicDir(musicDir)
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
