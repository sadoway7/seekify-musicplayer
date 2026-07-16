package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
