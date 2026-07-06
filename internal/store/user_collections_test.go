package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// Two users can favorite the same track independently; neither sees the other's.
func TestUserFavoritesIsolation(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	prevDB := DB
	DB = db
	defer func() {
		DB = prevDB
		db.Close()
	}()
	db.Exec(`CREATE TABLE user_favorites (user_id TEXT NOT NULL, track_id TEXT NOT NULL, added_at INTEGER DEFAULT 0, PRIMARY KEY (user_id, track_id))`)

	onA := DbToggleUserFavorite("alice", "track-XYZ")
	onB := DbToggleUserFavorite("bob", "track-XYZ")
	if !onA || !onB {
		t.Fatalf("both should be able to favorite the same track: onA=%v onB=%v", onA, onB)
	}

	fa := DbGetUserFavorites("alice")
	fb := DbGetUserFavorites("bob")
	if len(fa) != 1 || fa[0] != "track-XYZ" {
		t.Fatalf("alice favorites = %v", fa)
	}
	if len(fb) != 1 || fb[0] != "track-XYZ" {
		t.Fatalf("bob favorites = %v", fb)
	}

	// alice unfavorites; bob unaffected
	off := DbToggleUserFavorite("alice", "track-XYZ")
	if off {
		t.Fatal("expected alice to unfavorite")
	}
	if got := DbGetUserFavorites("alice"); len(got) != 0 {
		t.Fatalf("alice should have 0 favorites, got %v", got)
	}
	if got := DbGetUserFavorites("bob"); len(got) != 1 || got[0] != "track-XYZ" {
		t.Fatalf("bob should still have 1 favorite, got %v", got)
	}
}

// A user's playlists are isolated; shared (user_id='') playlists are visible to all.
func TestUserPlaylistsIsolation(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	prevDB := DB
	DB = db
	defer func() {
		DB = prevDB
		db.Close()
	}()
	db.Exec(`CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, user_id TEXT NOT NULL DEFAULT '')`)
	db.Exec(`CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT, position INTEGER, PRIMARY KEY (playlist_id, track_id))`)

	alicePL := DbCreatePlaylist("alice", "Alice's Mix")
	bobPL := DbCreatePlaylist("bob", "Bob's Mix")
	DbCreatePlaylist("", "Shared Radio") // system/shared

	aliceLists := DbGetPlaylists("alice")
	bobLists := DbGetPlaylists("bob")

	if len(aliceLists) != 2 {
		t.Fatalf("alice should see own + shared = 2, got %d", len(aliceLists))
	}
	if len(bobLists) != 2 {
		t.Fatalf("bob should see own + shared = 2, got %d", len(bobLists))
	}

	// bob cannot delete or mutate alice's playlist
	if DbDeletePlaylist("bob", alicePL.ID) {
		t.Fatal("bob should not be able to delete alice's playlist")
	}
	DbUpdatePlaylist("bob", alicePL.ID, "hacked", []string{"x"})
	// alice's playlist name unchanged + no tracks added
	stillAlice := DbGetPlaylists("alice")
	for _, p := range stillAlice {
		if p.ID == alicePL.ID && p.Name != "Alice's Mix" {
			t.Fatalf("bob mutated alice's playlist name to %q", p.Name)
		}
	}
	_ = bobPL
}
