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
		{"/index.html", http.StatusMovedPermanently}, // ServeMux canonicalizes to /
		{"/admin.html", http.StatusOK},
		{"/favicon.ico", http.StatusOK},
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
