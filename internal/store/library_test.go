package store

import (
	"testing"

	"musicapp/internal/models"
)

func TestUpdateWritesBackReboundMaps(t *testing.T) {
	prevT, prevA := tracks, albums
	t.Cleanup(func() { tracks, albums = prevT, prevA })

	ReplaceLibrary(
		map[string]*models.Track{"t1": {ID: "t1", Title: "A", Album: "X", AlbumArtist: "Ar", AlbumID: "x1"}},
		map[string]*models.Album{"x1": {ID: "x1", Name: "X"}},
	)

	// Rebind both maps wholesale inside an Update, as RebuildAlbums does.
	Update(func(l *Library) {
		l.Tracks = map[string]*models.Track{"t2": {ID: "t2"}}
		l.Albums = map[string]*models.Album{"y1": {ID: "y1"}}
	})

	if got := GetTrack("t1"); got != nil {
		t.Fatalf("rebound Tracks not written back: t1 still present")
	}
	if got := GetTrack("t2"); got == nil {
		t.Fatalf("rebound Tracks not written back: t2 missing")
	}
	if a := GetAlbum("y1"); a == nil {
		t.Fatalf("rebound Albums not written back")
	}
	if a := GetAlbum("x1"); a != nil {
		t.Fatalf("old album still visible after rebind")
	}
}

func TestReplaceLibraryNilKeepsExisting(t *testing.T) {
	prevT, prevA := tracks, albums
	t.Cleanup(func() { tracks, albums = prevT, prevA })

	ReplaceLibrary(map[string]*models.Track{"k": {ID: "k"}}, map[string]*models.Album{})
	ReplaceLibrary(map[string]*models.Track{"k2": {ID: "k2"}}, nil)
	if TrackCount() != 1 || GetTrack("k2") == nil {
		t.Fatalf("nil albums arg must keep existing albums, tracks replaced: count=%d", TrackCount())
	}
	if AlbumCount() != 0 {
		t.Fatalf("unexpected album count %d", AlbumCount())
	}
}
