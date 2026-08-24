package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func TestDownloadHandlerRejectsTrackWithDownloadsDisabled(t *testing.T) {
	var previousTracks map[string]*models.Track
	store.View(func(l *store.Library) { previousTracks = l.Tracks })
	store.ReplaceLibrary(map[string]*models.Track{
		"disabled": {
			ID:              "disabled",
			Title:           "No Download",
			DownloadEnabled: false,
		},
	}, nil)
	t.Cleanup(func() { store.ReplaceLibrary(previousTracks, nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/download/disabled", nil)
	rec := httptest.NewRecorder()
	DownloadHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
