package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"musicapp/internal/normalize"
	"musicapp/internal/store"
)

// NormalizeHandler returns the cached per-track gain_db, or kicks off analysis
// and returns 202. Returns 200 with enabled:false when the feature is off
// (no analysis kicked off in that case).
//
// GET /api/normalize/<trackID>
func NormalizeHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/normalize/")
	if trackID == "" {
		writeJSONError(w, http.StatusBadRequest, "missing track id")
		return
	}

	if !store.GetSettingBool("audio_normalization", true) {
		writeJSON(w, map[string]interface{}{"enabled": false})
		return
	}

	store.Mu.RLock()
	_, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		writeJSONError(w, http.StatusNotFound, "track not found")
		return
	}

	targetStr := store.GetSetting("audio_normalization_target_lufs", "-14")
	target, err := strconv.ParseFloat(strings.TrimSpace(targetStr), 64)
	if err != nil {
		target = -14
	}

	if g, ok := normalize.GetCachedGain(trackID); ok {
		writeJSON(w, map[string]interface{}{
			"track_id":    trackID,
			"gain_db":     g,
			"ready":       true,
			"target_lufs": target,
		})
		return
	}
	if normalize.IsUncomputable(trackID) {
		writeJSON(w, map[string]interface{}{
			"track_id":    trackID,
			"gain_db":     nil,
			"ready":       true,
			"target_lufs": target,
		})
		return
	}
	normalize.ComputeAsync(trackID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"track_id":    trackID,
		"ready":       false,
		"target_lufs": target,
	})
}
