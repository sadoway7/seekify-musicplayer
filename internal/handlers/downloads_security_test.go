package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func TestDownloadHandlerRejectsTrackWithDownloadsDisabled(t *testing.T) {
	store.Mu.Lock()
	previousTracks := store.Tracks
	store.Tracks = map[string]*models.Track{
		"disabled": {
			ID:              "disabled",
			Title:           "No Download",
			DownloadEnabled: false,
		},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = previousTracks
		store.Mu.Unlock()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/download/disabled", nil)
	rec := httptest.NewRecorder()
	DownloadHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
