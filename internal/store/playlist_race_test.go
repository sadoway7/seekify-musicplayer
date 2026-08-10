package store

import (
	"database/sql"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	_ "modernc.org/sqlite"
)

// TestDbAddTrackToPlaylistConcurrentPositions is a regression test for the
// read-modify-write race in DbAddTrackToPlaylist. It used to do
// SELECT MAX(position) then INSERT as two autocommit statements, so concurrent
// callers (several downloads finishing into the same playlist, watched-playlist
// sync racing a manual add) could both read the same maxPos and insert duplicate
// positions. The fix wraps the read+write in a BEGIN IMMEDIATE transaction
// (withImmediateTx), which serializes callers at the write lock.
//
// Invariant: after N concurrent adds of distinct tracks, every position is
// distinct and exactly N rows exist. Uses the prod DSN so busy_timeout applies to
// every pool connection (no SQLITE_BUSY drops masking the result).
func TestDbAddTrackToPlaylistConcurrentPositions(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	prevDB := DB
	DB = db
	t.Cleanup(func() {
		DB = prevDB
		db.Close()
	})
	if _, err := db.Exec(`CREATE TABLE playlist_tracks (
		playlist_id TEXT NOT NULL,
		track_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (playlist_id, track_id)
	)`); err != nil {
		t.Fatalf("create playlist_tracks: %v", err)
	}

	const goroutines = 40
	var wg sync.WaitGroup
	start := make(chan struct{})
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		track := "t" + strconv.Itoa(i)
		go func(track string) {
			defer wg.Done()
			<-start // barrier: fire all goroutines at once
			DbAddTrackToPlaylist("pl", track)
		}(track)
	}
	close(start)
	wg.Wait()

	rows := countT(t, `SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id='pl'`)
	dups := countT(t, `SELECT COUNT(*) FROM (
		SELECT position FROM playlist_tracks WHERE playlist_id='pl' GROUP BY position HAVING COUNT(*) > 1
	)`)
	t.Logf("%d tracks added, %d rows, %d duplicate-position groups", goroutines, rows, dups)

	if rows != goroutines {
		t.Fatalf("expected %d rows, got %d (some concurrent adds were lost)", goroutines, rows)
	}
	if dups != 0 {
		t.Fatalf("DbAddTrackToPlaylist produced %d duplicate positions — the BEGIN IMMEDIATE transaction did not serialize concurrent adds", dups)
	}
}
