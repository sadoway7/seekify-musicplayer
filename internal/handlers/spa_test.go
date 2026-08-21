package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestSpaHandlerWhitelist(t *testing.T) {
	// SpaHandler serves from CWD; tests run from package dir, so chdir to repo root.
	if err := os.Chdir("../.."); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		path       string
		wantStatus int
	}{
		{"/data/music.db", http.StatusNotFound},
		{"/.env", http.StatusNotFound},
		{"/vendor/modules.txt", http.StatusNotFound},
		{"/go.mod", http.StatusNotFound},
		{"/css/styles.css", http.StatusOK},
		{"/js/app.js", http.StatusOK},
		{"/index.html", http.StatusOK}, // served through the v=-busting path (was ServeFile's 301 to /)
		{"/admin.html", http.StatusOK},
		{"/favicon.ico", http.StatusOK},
		{"/icon.png", http.StatusOK},
		{"/icon-192.png", http.StatusOK},
		{"/favicon-32.png", http.StatusOK},
		{"/favicon-16.png", http.StatusOK},
		{"/apple-touch-icon.png", http.StatusOK},
		{"/manifest.webmanifest", http.StatusOK},
		{"/data/icon.png", http.StatusNotFound},  // nested PNG blocked
		{"/img/cover.jpg", http.StatusOK},
		{"/extension/musicapp-cookies.zip", http.StatusOK},
		{"/nonexistent-page", http.StatusNotFound}, // no file, no fallback hit in test env
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		w := httptest.NewRecorder()
		SpaHandler(w, req)
		if w.Code != tt.wantStatus {
			t.Errorf("SpaHandler(%q) = %d, want %d", tt.path, w.Code, tt.wantStatus)
		}
	}
}
