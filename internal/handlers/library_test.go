package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func TestLibraryHandler_ReturnsTracksAlbumsArtists(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))

	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{
		"t1": {ID: "t1", Title: "Song A", Artist: "Artist X", AlbumID: "a1", FilePath: "music/x/01.mp3"},
		"t2": {ID: "t2", Title: "Song B", Artist: "Artist Y", AlbumID: "a2", FilePath: "music/y/02.mp3"},
	}
	store.Albums = map[string]*models.Album{
		"a1": {ID: "a1", Name: "Album One", Artist: "Artist X"},
		"a2": {ID: "a2", Name: "Album Two", Artist: "Artist Y"},
	}
	store.Mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/library", nil)
	rec := httptest.NewRecorder()
	LibraryHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp models.LibraryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Tracks) != 2 {
		t.Errorf("tracks = %d, want 2", len(resp.Tracks))
	}
	if len(resp.Albums) != 2 {
		t.Errorf("albums = %d, want 2", len(resp.Albums))
	}
	if len(resp.Artists) != 2 {
		t.Errorf("artists = %d, want 2", len(resp.Artists))
	}
}
