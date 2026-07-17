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

func TestTrackGenreFieldsPersistAndSerialize(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "genre.db"))
	track := &models.Track{
		ID:             "genre-track",
		Title:          "Song",
		Artist:         "Artist",
		FilePath:       "Artist/Song.mp3",
		Genre:          "unknown raw tag",
		GenreCanonical: "Rock",
		GenreSource:    "musicbrainz",
		GenreCheckedAt: 123,
	}
	store.DbUpsertTrack(track)

	loaded := store.DbGetTrackByID(track.ID)
	if loaded == nil {
		t.Fatal("DbGetTrackByID returned nil")
	}
	if loaded.GenreCanonical != "Rock" || loaded.GenreSource != "musicbrainz" || loaded.GenreCheckedAt != 123 {
		t.Fatalf("loaded genre fields = %#v, want canonical Rock/musicbrainz/123", loaded)
	}
	raw := &models.Track{ID: "raw-genre", Title: "Raw", FilePath: "Raw.mp3", Genre: "melodic house"}
	store.DbUpsertTrack(raw)
	rawLoaded := store.DbGetTrackByID(raw.ID)
	if rawLoaded.GenreCanonical != "Melodic House" || rawLoaded.GenreSource != "tag" {
		t.Fatalf("raw genre hydration = %#v, want Melodic House/tag", rawLoaded)
	}

	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{track.ID: loaded, raw.ID: rawLoaded}
	store.Albums = map[string]*models.Album{}
	store.Mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/library", nil)
	rec := httptest.NewRecorder()
	LibraryHandler(rec, req)
	var resp models.LibraryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Tracks) != 2 {
		t.Fatalf("library tracks = %d, want 2", len(resp.Tracks))
	}
	seen := map[string]bool{}
	for _, got := range resp.Tracks {
		seen[got.GenreCanonical] = true
	}
	if !seen["Rock"] || !seen["Melodic House"] {
		t.Fatalf("library genreCanonical values = %#v, want Rock and Melodic House", seen)
	}
}

func TestTrackUpsertPreservesApprovedGenreMetadata(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "approved-genre.db"))
	approved := &models.Track{
		ID:             "approved-genre",
		Title:          "Song",
		FilePath:       "Song.mp3",
		Genre:          "Rock",
		GenreCanonical: "Rock",
		GenreSource:    "manual",
		HasMetadata:    true,
	}
	store.DbUpsertTrack(approved)

	rescan := *approved
	rescan.Genre = "Tech House"
	rescan.GenreCanonical = "Tech House"
	rescan.GenreSource = "tag"
	store.DbUpsertTrack(&rescan)

	loaded := store.DbGetTrackByID(approved.ID)
	if loaded.Genre != "Rock" || loaded.GenreCanonical != "Rock" || loaded.GenreSource != "manual" {
		t.Fatalf("approved genre changed after rescan: %#v", loaded)
	}
}
