package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/store"
)

func TestImportHandlersRejectAnonymousRequests(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		body    string
		handler http.HandlerFunc
	}{
		{
			name:    "bulk import",
			path:    "/api/bulk-import",
			body:    `{"lines":"Artist - Track"}`,
			handler: BulkImportHandler,
		},
		{
			name:    "playlist import",
			path:    "/api/playlist-import",
			body:    `{"url":"https://www.youtube.com/playlist?list=test"}`,
			handler: PlaylistImportHandler,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()

			tt.handler(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestSettingsSetHandler_RejectsBadTargetLufs(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	body := strings.NewReader(`{"audio_normalization_target_lufs":"loud"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/settings", body)
	rec := httptest.NewRecorder()
	SettingsSetHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status=%d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsSetHandler_RejectsOutOfRangeTargetLufs(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	body := strings.NewReader(`{"audio_normalization_target_lufs":"5"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/settings", body)
	rec := httptest.NewRecorder()
	SettingsSetHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status=%d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsSetHandler_AcceptsTargetLufs(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	body := strings.NewReader(`{"audio_normalization_target_lufs":"-16"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/settings", body)
	rec := httptest.NewRecorder()
	SettingsSetHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("status=%d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := store.GetSetting("audio_normalization_target_lufs", ""); got != "-16" {
		t.Errorf("persisted value=%s, want -16", got)
	}
}
