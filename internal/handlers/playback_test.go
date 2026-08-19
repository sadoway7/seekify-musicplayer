package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
	// Assign (not insert): store.InitDB doesn't populate Tracks, so a filtered
	// test run (-run TestPlayback...) must not depend on another test file
	// having seeded the map first.
	store.Tracks = map[string]*models.Track{"t1": {ID: "t1", Title: "T", Artist: "A"}}
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

func TestPlaybackFailureLog_RecordsEveryReasonAndRotatesWeekly(t *testing.T) {
	setupPlaybackTestDB(t)
	dir := filepath.Dir(store.DBPath)

	// A stale prior-week log must be deleted once a new failure is written.
	old := filepath.Join(dir, "playback-failures-2000-W01.jsonl")
	if err := os.WriteFile(old, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// A timeout report (code 0): must be logged even though it never flags.
	body, _ := json.Marshal(map[string]interface{}{"code": 0, "reason": "load-timeout", "transcode": true})
	req := httptest.NewRequest(http.MethodPost, "/api/playback-error/t1", strings.NewReader(string(body)))
	req.Header.Set("User-Agent", "UnitTestAgent/1.0")
	rec := httptest.NewRecorder()
	TrackPlaybackErrorHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	// Unknown track: still 404, but the failure is logged too.
	postPlayback(t, "nope", 3)

	req2 := httptest.NewRequest(http.MethodGet, "/api/admin/playback-failures", nil)
	rec2 := httptest.NewRecorder()
	PlaybackFailuresLogHandler(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("log status=%d", rec2.Code)
	}
	lines := strings.Split(strings.TrimSpace(rec2.Body.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 log lines, got %d: %q", len(lines), rec2.Body.String())
	}
	var entry map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("line 0 not JSON: %v", err)
	}
	if entry["trackId"] != "t1" || entry["reason"] != "load-timeout" || entry["wantsAac"] != true {
		t.Fatalf("entry=%v", entry)
	}
	if entry["ua"] != "UnitTestAgent/1.0" {
		t.Fatalf("ua=%v", entry["ua"])
	}
	var entry2 map[string]interface{}
	if err := json.Unmarshal([]byte(lines[1]), &entry2); err != nil {
		t.Fatalf("line 1 not JSON: %v", err)
	}
	if entry2["trackId"] != "nope" {
		t.Fatalf("entry2=%v", entry2)
	}

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("prior-week log must be deleted after a new write")
	}
}
