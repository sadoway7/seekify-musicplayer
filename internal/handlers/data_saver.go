// Data Saver preparation worker: one slow, background pass that gives every
// track a compact 128k copy and every image a compact WebP derivative — and
// rebuilds either when its source changes. Copies are tied to their sources:
// nothing is age- or size-pruned, and copies of deleted tracks are removed
// (transcode.RemoveOrphanCopies). All work runs niced behind the existing
// semaphores, so it churns through the list at whatever pace the machine
// allows without ever competing with playback.
package handlers

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"musicapp/internal/artcache"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
)

// SyncDataSaverAssets runs one full preparation pass. Safe to run any time
// after the library is loaded; every item is stat-gated so repeated passes
// only do the work that is actually missing. Gated by data_saver_enabled.
func SyncDataSaverAssets() {
	if !store.GetSettingBool("data_saver_enabled", true) {
		return
	}
	syncDataSaverAudio()
	syncDataSaverArt()
}

// syncDataSaverAudio: one stat per transcodable track decides — a fresh copy
// skips, a missing or stale one queues a background encode.
func syncDataSaverAudio() {
	if !store.GetSettingBool("transcode_enabled", true) {
		return
	}
	type candidate struct{ id, path string }
	var candidates []candidate
	store.View(func(l *store.Library) {
		for _, t := range l.Tracks {
			candidates = append(candidates, candidate{t.ID, t.FilePath})
		}
	})
	prepared := 0
	for _, c := range candidates {
		fullPath := scanner.ResolveFilePath(c.path)
		ext := strings.ToLower(filepath.Ext(fullPath))
		forced := ext == ".m4a" && transcode.IsBrowserUnsupportedM4A(fullPath)
		if !needsTranscode(ext) && !forced {
			continue
		}
		if transcode.IsReadyAt(c.id, fullPath, "128") {
			continue
		}
		if _, err := transcode.EnsureLowAt(c.id, fullPath, "128"); err == nil {
			prepared++
		}
	}
	if prepared > 0 {
		log.Printf("[data-saver] audio: prepared %d compact track copy(s)", prepared)
	}
}

// syncDataSaverArt: walk the original-art directories; any source whose WebP
// derivative is missing or stale gets a background reconvert. Sequential by
// design — each convert is niced, so the pass simply takes its time.
// Zero-byte files are skipped: they are the cover-fetcher's "no cover found"
// negative markers, not real images.
func syncDataSaverArt() {
	if !artcache.Available() {
		return
	}
	images := filepath.Join(filepath.Dir(store.DBPath), "images")
	prepared := 0
	for _, class := range []struct{ dir, name string }{
		{images, "covers"},
		{filepath.Join(images, "artists"), "artists"},
	} {
		entries, err := os.ReadDir(class.dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".jpg") {
				continue
			}
			if info, err := e.Info(); err == nil && info.Size() == 0 {
				continue
			}
			src := filepath.Join(class.dir, e.Name())
			webp := artcache.Path(class.name, e.Name())
			if artcache.Fresh(webp, src) {
				continue
			}
			if artcache.ConvertSync(webp, src) {
				prepared++
			}
		}
	}
	if prepared > 0 {
		log.Printf("[data-saver] art: prepared %d WebP image(s)", prepared)
	}
}
