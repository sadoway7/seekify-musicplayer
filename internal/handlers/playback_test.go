package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/review"
	"musicapp/internal/store"
)

func setupPlaybackTestDB(t *testing.T) {
	t.Helper()
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	review.InitReviewTables()
	store.Mu.Lock()
	store.Tracks["t1"] = &models.Track{ID: "t1", Title: "T", Artist: "A"}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		delete(store.Tracks, "t1")
		store.Mu.Unlock()
	})
}

func postPlayback(t *testing.T, trackID string, code int) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]int{"code": code})
	req := httptest.NewRequest(http.MethodPost, "/api/playback-error/"+trackID, strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	TrackPlaybackErrorHandler(rec, req)
	return rec
}

func hasFlag(flags []string, v string) bool {
	for _, f := range flags {
		if f == v {
			return true
		}
	}
	return false
}

func TestPlaybackError_FlagsDecodeAndUnsupported(t *testing.T) {
	setupPlaybackTestDB(t)
	for _, code := range []int{3, 4} {
		review.DbSetReviewStatus("t1", "unchecked", "[]", "")
		rec := postPlayback(t, "t1", code)
		if rec.Code != http.StatusOK {
			t.Fatalf("code %d: status=%d body=%s", code, rec.Code, rec.Body.String())
		}
		status, flags := review.DbGetReviewForTrack("t1")
		if status != "needs_review" {
			t.Fatalf("code %d: status=%q want needs_review", code, status)
		}
		if !hasFlag(flags, "playback_error") {
			t.Fatalf("code %d: flags=%v want playback_error", code, flags)
		}
	}
}

func TestPlaybackError_IgnoresNetworkError(t *testing.T) {
	setupPlaybackTestDB(t)
	review.DbSetReviewStatus("t1", "reviewed_ok", "[]", "")
	rec := postPlayback(t, "t1", 2)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	status, _ := review.DbGetReviewForTrack("t1")
	if status != "reviewed_ok" {
		t.Fatalf("network error must not flag a track; status=%q", status)
	}
}

func TestPlaybackError_MergesWithoutClobbering(t *testing.T) {
	setupPlaybackTestDB(t)
	review.DbSetReviewStatus("t1", "needs_review", `["missing_title"]`, "worker")
	postPlayback(t, "t1", 3)
	_, flags := review.DbGetReviewForTrack("t1")
	if !hasFlag(flags, "missing_title") || !hasFlag(flags, "playback_error") {
		t.Fatalf("flags=%v want both missing_title and playback_error", flags)
	}
}

func TestPlaybackError_UnknownTrack404(t *testing.T) {
	setupPlaybackTestDB(t)
	rec := postPlayback(t, "nope", 3)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", rec.Code)
	}
}
