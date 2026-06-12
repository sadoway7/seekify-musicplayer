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

// startWatcher polls music directories for changes.
// The interval is configurable via the "watcher_interval" setting (default 30s).
// It can be disabled entirely via the "watcher_enabled" setting.
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

	for {
		if !getSettingBool("watcher_enabled", true) {
			time.Sleep(5 * time.Minute)
			continue
		}

		interval := getSettingInt("watcher_interval", 30)
		if interval < 5 {
			interval = 5
		}
		time.Sleep(time.Duration(interval) * time.Second)

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

		// Debounce: wait 5s and re-check to filter transient changes
		time.Sleep(5 * time.Second)
		current = countAudioFiles(d.dir)
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

		watcherMu.Lock()
		lastFileCounts[d.dir] = current
		watcherMu.Unlock()

		// Notify frontend that library changed
		libraryVersion.Add(1)
	}
}
