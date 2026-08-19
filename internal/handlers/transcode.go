package handlers

import (
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
// background.
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

	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		http.NotFound(w, r)
		return
	}

	fullPath := scanner.ResolveFilePath(track.FilePath)
	ext := strings.ToLower(filepath.Ext(fullPath))
	if !needsTranscode(ext) {
		writeJSON(w, map[string]bool{"ready": true})
		return
	}
	if transcode.IsReady(trackID, fullPath) {
		writeJSON(w, map[string]bool{"ready": true})
		return
	}

	store.SafeGo("transcode-warm", func() {
		// Background priority: a warm encode must yield CPU to any foreground
		// play encode (playback-first policy, same as waveform/bands/normalize).
		transcode.EnsureLow(trackID, fullPath)
	})
	writeJSON(w, map[string]bool{"ready": false})
}
