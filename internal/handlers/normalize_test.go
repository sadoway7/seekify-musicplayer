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

func TestNormalizeHandler_NotFound(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	store.ReplaceLibrary(map[string]*models.Track{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/normalize/nope", nil)
	rec := httptest.NewRecorder()
	NormalizeHandler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestNormalizeHandler_Cached(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	// Insert a track row directly so gain_db can be set.
	_, err := store.DB.Exec(`INSERT INTO tracks (id, title, artist, album, album_artist, album_id, track_number, year, genre, genre_canonical, genre_source, genre_checked_at, duration, file_path, has_cover, mod_time, has_metadata, gain_db) VALUES ('t1','Song','A','','','',0,0,'','','',0,0,'music/x.mp3',0,0,0,-3.2)`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	store.ReplaceLibrary(map[string]*models.Track{
		"t1": {ID: "t1", Title: "Song", Artist: "A", FilePath: "music/x.mp3"},
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/normalize/t1", nil)
	rec := httptest.NewRecorder()
	NormalizeHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		TrackID    string   `json:"track_id"`
		GainDb     *float64 `json:"gain_db"`
		Ready      bool     `json:"ready"`
		TargetLufs float64  `json:"target_lufs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.GainDb == nil || *resp.GainDb != -3.2 {
		t.Errorf("gain_db=%v, want -3.2", resp.GainDb)
	}
	if !resp.Ready {
		t.Error("ready=false, want true for cached gain")
	}
}

func TestNormalizeHandler_Disabled(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	store.SetSetting("audio_normalization", "false")
	defer store.SetSetting("audio_normalization", "true")

	store.ReplaceLibrary(map[string]*models.Track{
		"t1": {ID: "t1", Title: "Song", FilePath: "music/x.mp3"},
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/normalize/t1", nil)
	rec := httptest.NewRecorder()
	NormalizeHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v; body=%s", err, rec.Body.String())
	}
	if resp.Enabled == nil || *resp.Enabled != false {
		t.Errorf("expected enabled=false; body=%s", rec.Body.String())
	}
}
