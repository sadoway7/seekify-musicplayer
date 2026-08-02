package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"musicapp/internal/review"
	"musicapp/internal/store"
)

// TrackPlaybackErrorHandler receives a browser-reported HTMLMedia error for a
// track and flags genuinely unplayable files for review. Mirrors the
// /api/track-duration/<id> feedback channel (browser → server during playback).
//
// Error codes (HTMLMediaElement.error.code):
//   2 = MEDIA_ERR_NETWORK  — transient (connection); ignored.
//   3 = MEDIA_ERR_DECODE   — the file itself is corrupt/unreadable; flagged.
//   4 = MEDIA_ERR_SRC_NOT_SUPPORTED — browser can't decode it (codec/corruption);
//          flagged so the user can re-download or transcode.
//
// Only codes 3/4 are acted on — a network blip must never flag a track. Decode
// failures are deterministic per file, so one report is enough; Needs Review is
// non-destructive (a false positive is cleared by a manual approve).
func TrackPlaybackErrorHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimPrefix(r.URL.Path, "/api/playback-error/")
	if trackID == "" {
		http.Error(w, `{"error":"track id required"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	// Only file-intrinsic failures warrant a flag.
	if body.Code != 3 && body.Code != 4 {
		writeJSON(w, map[string]bool{"ok": true})
		return
	}

	store.Mu.RLock()
	_, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		http.NotFound(w, r)
		return
	}

	// Merge playback_error into existing flags (don't clobber other flags, and
	// don't down-grade a track that's already needs_review with richer context).
	_, flags := review.DbGetReviewForTrack(trackID)
	has := false
	for _, f := range flags {
		if f == "playback_error" {
			has = true
			break
		}
	}
	if !has {
		flags = append(flags, "playback_error")
	}
	flagsJSON, _ := json.Marshal(flags)
	review.DbSetReviewStatus(trackID, "needs_review", string(flagsJSON), "playback")

	store.Mu.Lock()
	if t, ok := store.Tracks[trackID]; ok {
		t.ReviewStatus = "needs_review"
		t.ReviewFlags = flags
	}
	store.Mu.Unlock()

	writeJSON(w, map[string]bool{"ok": true})
}
