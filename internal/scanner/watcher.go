package scanner

import (
	"hash/fnv"
	"log"
	"musicapp/internal/store"
	"os"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	watcherMu        sync.Mutex
	lastFileSnapshot map[string]audioSnapshot
	lastPrune        time.Time
)

type audioSnapshot struct {
	count     int
	signature uint64
}

func init() {
	lastFileSnapshot = make(map[string]audioSnapshot)
	lastPrune = time.Now()
}

// CountAudioFiles counts audio files in a directory tree, excluding the
// Soulseek share folder so it doesn't trigger rescans or defeat the
// startup scan-skip optimization.
func CountAudioFiles(dir string) int {
	return snapshotAudioFiles(dir).count
}

// snapshotAudioFiles is used by the running watcher to detect replacements,
// renames, and modifications that leave the total file count unchanged. The
// startup scan-skip remains count-only.
func snapshotAudioFiles(dir string) audioSnapshot {
	skipDir := filepath.Clean(store.SlskShareDir())
	return snapshotAudioFilesSkipping(dir, skipDir)
}

func snapshotAudioFilesSkipping(dir, skipDir string) audioSnapshot {
	snapshot := audioSnapshot{}
	h := fnv.New64a()
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
			snapshot.count++
			rel, relErr := filepath.Rel(dir, path)
			if relErr != nil {
				rel = path
			}
			h.Write([]byte(filepath.ToSlash(rel)))
			h.Write([]byte{0})
			h.Write([]byte(strconv.FormatInt(info.Size(), 10)))
			h.Write([]byte{0})
			h.Write([]byte(strconv.FormatInt(info.ModTime().UnixNano(), 10)))
			h.Write([]byte{0})
		}
		return nil
	})
	snapshot.signature = h.Sum64()
	return snapshot
}

// StartWatcher polls music directories for changes.
// The interval is configurable via the "watcher_interval" setting (default 30s).
// It can be disabled entirely via the "watcher_enabled" setting.
func StartWatcher() {
	// Record initial counts after startup scan
	watcherMu.Lock()
	lastFileSnapshot[store.MusicDir] = snapshotAudioFiles(store.MusicDir)
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		lastFileSnapshot[dir] = snapshotAudioFiles(dir)
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
	lastFileSnapshot[store.MusicDir] = snapshotAudioFiles(store.MusicDir)
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		lastFileSnapshot[dir] = snapshotAudioFiles(dir)
	}
	watcherMu.Unlock()
}

func CheckAndRescan() {
	store.WorkerStart("scanner")
	didWork := false
	defer func() {
		store.WorkerDoneTick("scanner", didWork, nil)
	}()

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
		current := snapshotAudioFiles(d.dir)

		watcherMu.Lock()
		previous := lastFileSnapshot[d.dir]
		watcherMu.Unlock()

		if current == previous {
			continue
		}

		// Debounce: wait 5s and re-check to filter transient changes
		time.Sleep(5 * time.Second)
		current = snapshotAudioFiles(d.dir)
		if current == previous {
			continue
		}

		diff := current.count - previous.count
		if diff < 0 {
			diff = -diff
		}

		label := d.dir
		if d.prefix != "" {
			label = d.prefix + ":" + d.dir
		}
		if current.count == previous.count {
			log.Printf("[watcher] %s: audio files changed with count still at %d, triggering rescan", label, current.count)
		} else {
			log.Printf("[watcher] %s: file count changed %d → %d (+%d), triggering rescan", label, previous.count, current.count, diff)
		}

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
		lastFileSnapshot[d.dir] = current
		watcherMu.Unlock()

		if LibraryVersionAdd != nil {
			LibraryVersionAdd(1)
		}
		didWork = true
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
