package handlers

import (
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
)

// needsTranscode reports whether a file extension must be transcoded for
// clients that can't stream it natively (iOS/macOS Safari: no FLAC/Opus/Ogg
// progressive playback; WAV streams but is enormous). m4a/aac/mp3 pass
// through untouched.
func needsTranscode(ext string) bool {
	switch ext {
	case ".flac", ".opus", ".ogg", ".wav":
		return true
	}
	return false
}

// TranscodeWarmHandler pre-primes the transcode cache for a track so the
// first play on a Safari client is instant. Idempotent: no-op when the
// cache is already fresh or the format doesn't need transcoding. Returns
// {ready: bool} — ready=false means transcode was kicked off in the
// background. Honors ?b=<bitrate> so a data-saver client warms the exact
// copy it will request.
//
// POST /api/transcode-warm/<trackID>
func TranscodeWarmHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimPrefix(r.URL.Path, "/api/transcode-warm/")
	if trackID == "" {
		writeJSONError(w, http.StatusBadRequest, "track id required")
		return
	}

	bitrate := r.URL.Query().Get("b")
	if bitrate != "128" && bitrate != "192" {
		bitrate = ""
	}

	track := store.GetTrack(trackID)
	if track == nil {
		http.NotFound(w, r)
		return
	}

	fullPath := scanner.ResolveFilePath(track.FilePath)
	ext := strings.ToLower(filepath.Ext(fullPath))
	if !needsTranscode(ext) {
		writeJSON(w, map[string]bool{"ready": true})
		return
	}
	if transcode.IsReadyAt(trackID, fullPath, bitrate) {
		writeJSON(w, map[string]bool{"ready": true})
		return
	}

	store.SafeGo("transcode-warm", func() {
		// Background priority: a warm encode must yield CPU to any foreground
		// play encode (playback-first policy, same as waveform/bands/normalize).
		transcode.EnsureLowAt(trackID, fullPath, bitrate)
	})
	writeJSON(w, map[string]bool{"ready": false})
}

// WarmTranscodeCache backgrounds a low-priority AAC encode for a freshly
// ingested track (upload or download). Without this, a large lossless file's
// first play pays the full cost cold: Safari blocks on the encode inside
// StreamHandler, and FLAC-capable browsers (Chrome) stream the 30-100MB raw
// file, stall, burn the 10s load timeout, and only then retry via ?fmt=aac.
// Warming at ingest means the compact cached copy already exists when the
// first play needs it. No-op for formats that never transcode.
func WarmTranscodeCache(trackID, path string) {
	if !store.GetSettingBool("transcode_enabled", true) {
		return
	}
	ext := strings.ToLower(filepath.Ext(path))
	forced := ext == ".m4a" && transcode.IsBrowserUnsupportedM4A(path)
	if !needsTranscode(ext) && !forced {
		return
	}
	store.SafeGo("warm-ingest-transcode", func() {
		transcode.EnsureLow(trackID, path)
		// Data Saver plays request a separate smaller copy — warm it too so
		// the first data-saver play of a fresh download never waits.
		transcode.EnsureLowAt(trackID, path, "128")
	})
}

// Backfill128Cache warms the 128k Data Saver copy for every library track
// that can transcode. Marker-guarded like BackfillTranscodeCache (runs once
// per library), background priority, and bounded by the shared encode
// semaphore — it never competes with foreground playback for CPU.
func Backfill128Cache() {
	if !store.GetSettingBool("transcode_enabled", true) {
		return
	}
	if store.GetSettingBool("transcode_128_backfill_done", false) {
		return
	}

	type candidate struct{ id, path string }
	var candidates []candidate
	store.View(func(l *store.Library) {
		for _, t := range l.Tracks {
			candidates = append(candidates, candidate{t.ID, t.FilePath})
		}
	})

	warmed := 0
	for _, c := range candidates {
		fullPath := scanner.ResolveFilePath(c.path)
		ext := strings.ToLower(filepath.Ext(fullPath))
		forced := ext == ".m4a" && transcode.IsBrowserUnsupportedM4A(fullPath)
		if !needsTranscode(ext) && !forced {
			continue
		}
		if _, err := transcode.EnsureLowAt(c.id, fullPath, "128"); err == nil {
			warmed++
		}
	}
	store.SetSetting("transcode_128_backfill_done", "1")
	log.Printf("[transcode] 128k backfill complete: warmed %d/%d track(s)", warmed, len(candidates))
}

// BackfillTranscodeCache warms the AAC cache for every library track that
// needs one, one encode at a time at background priority. Marker-guarded so
// it runs once per library ever: tracks ingested after the sweep are warmed
// at ingest (upload/download paths), and PruneCache caps the total. This
// exists for libraries built before ingest-time warming — their first play
// on Safari blocked on a cold encode inside StreamHandler.
func BackfillTranscodeCache() {
	if !store.GetSettingBool("transcode_enabled", true) {
		return
	}
	if store.GetSettingBool("transcode_backfill_done", false) {
		return
	}

	type candidate struct{ id, path string }
	var candidates []candidate
	store.View(func(l *store.Library) {
		for _, t := range l.Tracks {
			candidates = append(candidates, candidate{t.ID, t.FilePath})
		}
	})

	warmed := 0
	for _, c := range candidates {
		fullPath := scanner.ResolveFilePath(c.path)
		ext := strings.ToLower(filepath.Ext(fullPath))
		forced := ext == ".m4a" && transcode.IsBrowserUnsupportedM4A(fullPath)
		if !needsTranscode(ext) && !forced {
			continue
		}
		if _, err := transcode.EnsureLow(c.id, fullPath); err == nil {
			warmed++
		}
	}
	store.SetSetting("transcode_backfill_done", "1")
	log.Printf("[transcode] Backfill complete: warmed %d/%d track(s)", warmed, len(candidates))
}
