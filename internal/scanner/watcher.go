package scanner

import (
	"log"
	"musicapp/internal/store"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

var (
	watcherMu      sync.Mutex
	lastFileCounts map[string]int
	lastPrune      time.Time
)

func init() {
	lastFileCounts = make(map[string]int)
	lastPrune = time.Now()
}

// CountAudioFiles counts audio files in a directory tree, excluding the
// Soulseek share folder so it doesn't trigger rescans or defeat the
// startup scan-skip optimization.
func CountAudioFiles(dir string) int {
	skipDir := filepath.Clean(store.SlskShareDir())
	count := 0
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if path == skipDir || strings.HasPrefix(path, skipDir+string(filepath.Separator)) {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if _, ok := store.AudioExtensions[ext]; ok {
			count++
		}
		return nil
	})
	return count
}

// StartWatcher polls music directories for changes.
// The interval is configurable via the "watcher_interval" setting (default 30s).
// It can be disabled entirely via the "watcher_enabled" setting.
func StartWatcher() {
	// Record initial counts after startup scan
	watcherMu.Lock()
	lastFileCounts[store.MusicDir] = CountAudioFiles(store.MusicDir)
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		lastFileCounts[dir] = CountAudioFiles(dir)
	}
	watcherMu.Unlock()

	for {
		if !store.GetSettingBool("watcher_enabled", true) {
			time.Sleep(5 * time.Minute)
			continue
		}

		interval := store.GetSettingInt("watcher_interval", 30)
		if interval < 5 {
			interval = 5
		}
		time.Sleep(time.Duration(interval) * time.Second)

		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[watcher] panic recovered: %v\n%s", r, debug.Stack())
				}
			}()
			CheckAndRescan()
		}()
	}
}

// ForceRescan runs a full scan of all music directories regardless of
// file count changes. Used by the "Run Now" button on the scanner worker.
func ForceRescan() {
	store.WorkerStart("scanner")
	defer store.WorkerDone("scanner", nil)

	if scanning.Load() {
		return
	}

	ScanMusicDir(store.MusicDir)
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		ScanMusicDirWithPrefix(dir, prefix)
	}

	ExtractEmbeddedCovers()

	if LibraryVersionAdd != nil {
		LibraryVersionAdd(1)
	}

	// Update file counts so the watcher doesn't immediately re-trigger
	watcherMu.Lock()
	lastFileCounts[store.MusicDir] = CountAudioFiles(store.MusicDir)
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		lastFileCounts[dir] = CountAudioFiles(dir)
	}
	watcherMu.Unlock()
}

func CheckAndRescan() {
	store.WorkerStart("scanner")
	defer store.WorkerDone("scanner", nil)

	// Don't rescan while a scan is already running (e.g. startup scan still
	// in progress); the next watcher tick will pick up the changes.
	if scanning.Load() {
		return
	}

	dirs := []struct {
		dir    string
		prefix string
	}{
		{store.MusicDir, ""},
	}

	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		dirs = append(dirs, struct {
			dir    string
			prefix string
		}{dir, prefix})
	}

	for _, d := range dirs {
		current := CountAudioFiles(d.dir)

		watcherMu.Lock()
		previous := lastFileCounts[d.dir]
		watcherMu.Unlock()

		if current == previous {
			continue
		}

		// Debounce: wait 5s and re-check to filter transient changes
		time.Sleep(5 * time.Second)
		current = CountAudioFiles(d.dir)
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
			stats := ScanMusicDir(store.MusicDir)
			store.Mu.RLock()
			trackCount := len(store.Tracks)
			store.Mu.RUnlock()
			log.Printf("[watcher] Primary rescan: %d scanned, %d total tracks", stats.Scanned, trackCount)
		} else {
			stats := ScanMusicDirWithPrefix(d.dir, d.prefix)
			store.Mu.RLock()
			trackCount := len(store.Tracks)
			store.Mu.RUnlock()
			log.Printf("[watcher] Media rescan [%s]: %d scanned, %d total tracks", d.prefix, stats.Scanned, trackCount)
		}

		// Extract covers for any new files
		ExtractEmbeddedCovers()

		watcherMu.Lock()
		lastFileCounts[d.dir] = current
		watcherMu.Unlock()

		if LibraryVersionAdd != nil {
			LibraryVersionAdd(1)
		}
	}

	watcherMu.Lock()
	runPrune := time.Since(lastPrune) > 5*time.Minute
	if runPrune {
		lastPrune = time.Now()
	}
	watcherMu.Unlock()
	if runPrune {
		store.WorkerStart("cleanup")
		PruneMissingTracks()
		PruneSharedDirTracks()
		PruneTruncatedTracks()
		store.DedupTracks()
		store.WorkerDone("cleanup", nil)
	}
}
