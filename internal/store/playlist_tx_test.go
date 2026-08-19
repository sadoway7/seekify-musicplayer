package store

import (
	"fmt"
	"path/filepath"
	"testing"
)

// TestDbUpdatePlaylistLargeReinsert exercises the transactional rewrite path:
// a large delete + reinsert must leave the playlist complete and correctly
// ordered. Before the withImmediateTx wrap, any mid-loop failure committed the
// DELETE and dropped the rest — emptying the playlist.
func TestDbUpdatePlaylistLargeReinsert(t *testing.T) {
	InitDB(filepath.Join(t.TempDir(), "test.db"))

	p := DbCreatePlaylist("alice", "Big Mix")
	ids := make([]string, 5000)
	for i := range ids {
		ids[i] = fmt.Sprintf("t%04d", i)
	}
	DbUpdatePlaylist("alice", p.ID, "Big Mix v2", ids)

	got := DbGetPlaylistTracks(p.ID)
	if len(got) != len(ids) {
		t.Fatalf("playlist has %d tracks after rewrite, want %d", len(got), len(ids))
	}
	if got[0] != ids[0] || got[len(ids)-1] != ids[len(ids)-1] {
		t.Fatalf("ordering broken: first=%q last=%q", got[0], got[len(ids)-1])
	}
	pl := DbFindPlaylistByID(p.ID)
	if pl == nil || pl.Name != "Big Mix v2" {
		t.Fatalf("rename lost inside tx: %+v", pl)
	}

	// Ownership check still holds under the new tx.
	DbUpdatePlaylist("bob", p.ID, "hacked", []string{"x"})
	if got := DbGetPlaylistTracks(p.ID); len(got) != len(ids) {
		t.Fatalf("non-owner rewrote playlist: %d tracks", len(got))
	}
}
