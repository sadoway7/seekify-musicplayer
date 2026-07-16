package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func TestParseByteRange(t *testing.T) {
	tests := []struct {
		name      string
		header    string
		fileSize  int64
		wantStart int64
		wantEnd   int64
		wantValid bool
	}{
		{name: "explicit", header: "bytes=2-5", fileSize: 10, wantStart: 2, wantEnd: 5, wantValid: true},
		{name: "open ended", header: "bytes=6-", fileSize: 10, wantStart: 6, wantEnd: 9, wantValid: true},
		{name: "suffix", header: "bytes=-4", fileSize: 10, wantStart: 6, wantEnd: 9, wantValid: true},
		{name: "large suffix", header: "bytes=-20", fileSize: 10, wantStart: 0, wantEnd: 9, wantValid: true},
		{name: "zero suffix", header: "bytes=-0", fileSize: 10, wantValid: false},
		{name: "past end", header: "bytes=10-", fileSize: 10, wantValid: false},
		{name: "backwards", header: "bytes=7-3", fileSize: 10, wantValid: false},
		{name: "multiple", header: "bytes=0-1,4-5", fileSize: 10, wantValid: false},
		{name: "wrong unit", header: "items=0-1", fileSize: 10, wantValid: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, end, valid := parseByteRange(tt.header, tt.fileSize)
			if valid != tt.wantValid || start != tt.wantStart || end != tt.wantEnd {
				t.Fatalf("parseByteRange(%q, %d) = (%d, %d, %v), want (%d, %d, %v)",
					tt.header, tt.fileSize, start, end, valid, tt.wantStart, tt.wantEnd, tt.wantValid)
			}
		})
	}
}

func TestStreamHandlerSuffixRange(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "track.mp3"), []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}

	store.Mu.Lock()
	previousTracks := store.Tracks
	previousMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.mp3"},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = previousTracks
		store.MusicDir = previousMusicDir
		store.Mu.Unlock()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track", nil)
	req.Header.Set("Range", "bytes=-4")
	rec := httptest.NewRecorder()

	StreamHandler(rec, req)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPartialContent)
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 6-9/10" {
		t.Fatalf("Content-Range = %q, want %q", got, "bytes 6-9/10")
	}
	if got := rec.Body.String(); got != "6789" {
		t.Fatalf("body = %q, want %q", got, "6789")
	}
}
