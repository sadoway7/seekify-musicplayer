package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/auth"
	"musicapp/internal/store"
)

func setupCollectionsTest(t *testing.T) (req func(method, path, body string) *http.Request, userID string) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "handler.db"))
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})

	u, err := auth.CreateUser("alice", "password123", auth.RoleUser, "")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token, err := auth.CreateSession(u.ID, "test", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	return func(method, path, body string) *http.Request {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		return req
	}, u.ID
}

func playlistName(t *testing.T, id string) string {
	t.Helper()
	var name string
	if err := store.DB.QueryRow(`SELECT name FROM playlists WHERE id = ?`, id).Scan(&name); err != nil {
		t.Fatalf("playlist name for %s: %v", id, err)
	}
	return name
}

// PUT on a shared/system playlist (user_id='', e.g. watched-playlist-backed)
// must fail with 403 instead of returning 200 with the unchanged playlist —
// previously edits were silently discarded while the UI showed "saved".
// The owner path is the guard: edits to an owned playlist still apply.
func TestPlaylistPutSharedReadOnly(t *testing.T) {
	req, userID := setupCollectionsTest(t)

	shared := store.DbCreatePlaylist("", "Watched Radio")
	own := store.DbCreatePlaylist(userID, "My Mix")

	// Fixture sanity: the shared playlist is listed for this user.
	listed := false
	for _, p := range store.DbGetPlaylists(userID) {
		if p.ID == shared.ID {
			listed = true
		}
	}
	if !listed {
		t.Fatal("fixture: shared playlist should be listed for the user")
	}

	rec := callHandler(t, PlaylistHandler, req(http.MethodPut, "/api/playlists/"+shared.ID, `{"name":"Renamed"}`))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PUT shared playlist: status = %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "shared playlists are read-only") {
		t.Fatalf("PUT shared playlist body = %q, want it to contain %q", rec.Body.String(), "shared playlists are read-only")
	}
	if got := playlistName(t, shared.ID); got != "Watched Radio" {
		t.Fatalf("shared playlist was mutated: name = %q", got)
	}

	// Owner path guard: own playlist edits still apply and return 200.
	rec = callHandler(t, PlaylistHandler, req(http.MethodPut, "/api/playlists/"+own.ID, `{"name":"My Mix v2","trackIds":["t1","t2"]}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT own playlist: status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var updated struct {
		Name     string   `json:"name"`
		TrackIDs []string `json:"trackIds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode own-playlist response: %v", err)
	}
	if updated.Name != "My Mix v2" {
		t.Fatalf("own playlist rename not applied: name = %q", updated.Name)
	}
	if len(updated.TrackIDs) != 2 || updated.TrackIDs[0] != "t1" || updated.TrackIDs[1] != "t2" {
		t.Fatalf("own playlist track rewrite not applied: %v", updated.TrackIDs)
	}
}
