package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	watcherMu      sync.Mutex
	lastFileCounts map[string]int
)

func init() {
	lastFileCounts = make(map[string]int)
}

// countAudioFiles counts audio files in a directory tree.
func countAudioFiles(dir string) int {
	count := 0
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if _, ok := audioExtensions[ext]; ok {
			count++
		}
		return nil
	})
	return count
}

// startWatcher polls music directories every 30 seconds.
// If the file count changes, it triggers a targeted rescan.
func startWatcher() {
	// Record initial counts after startup scan
	watcherMu.Lock()
	lastFileCounts[musicDir] = countAudioFiles(musicDir)
	for prefix, dir := range musicDirs {
		if prefix == "" {
			continue
		}
		lastFileCounts[dir] = countAudioFiles(dir)
	}
	watcherMu.Unlock()

	log.Printf("[watcher] Monitoring music directories for changes (30s interval)")

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		checkAndRescan()
	}
}

func checkAndRescan() {
	dirs := []struct {
		dir    string
		prefix string
	}{
		{musicDir, ""},
	}

	for prefix, dir := range musicDirs {
		if prefix == "" {
			continue
		}
		dirs = append(dirs, struct {
			dir    string
			prefix string
		}{dir, prefix})
	}

	for _, d := range dirs {
		current := countAudioFiles(d.dir)

		watcherMu.Lock()
		previous := lastFileCounts[d.dir]
		watcherMu.Unlock()

		if current == previous {
			continue
		}

		diff := current - previous
		if diff < 0 {
			diff = -diff
		}

		label := d.dir
		if d.prefix != "" {
			label = d.prefix + ":" + d.dir
		}
		log.Printf("[watcher] %s: file count changed %d → %d (+%d), triggering rescan", label, previous, current, diff)

		// Rescan the changed directory
		if d.prefix == "" {
			stats := scanMusicDir(musicDir)
			mu.RLock()
			trackCount := len(tracks)
			mu.RUnlock()
			log.Printf("[watcher] Primary rescan: %d scanned, %d total tracks", stats.Scanned, trackCount)
		} else {
			stats := scanMusicDirWithPrefix(d.dir, d.prefix)
			mu.RLock()
			trackCount := len(tracks)
			mu.RUnlock()
			log.Printf("[watcher] Media rescan [%s]: %d scanned, %d total tracks", d.prefix, stats.Scanned, trackCount)
		}

		// Extract covers for any new files
		extractEmbeddedCovers()

		// Update stored count
		watcherMu.Lock()
		lastFileCounts[d.dir] = current
		watcherMu.Unlock()
	}
}
