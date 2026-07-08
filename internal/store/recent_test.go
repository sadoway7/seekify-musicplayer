package store

import (
	"strconv"
	"testing"
)

// TestDbAddUserRecentTrim verifies DbAddUserRecent caps history at the 50
// most-recently-played tracks. A prior version inverted the trim subquery
// (ORDER BY position DESC) and evicted the NEWEST entries instead of the
// oldest, so the home "Recently Played" showed stale tracks once a user
// passed 50 distinct plays.
func TestDbAddUserRecentTrim(t *testing.T) {
	setupMigrationTestDB(t)
	const u = "u1"
	// Add 60 distinct tracks: t0 (oldest) .. t59 (newest).
	for i := 0; i < 60; i++ {
		DbAddUserRecent(u, "t"+strconv.Itoa(i))
	}
	if got := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=?`, u); got != 50 {
		t.Fatalf("after 60 adds, user_recent has %d rows, want 50", got)
	}
	// Oldest 10 (t0..t9) must be evicted; newest 50 (t10..t59) retained.
	for i := 0; i < 10; i++ {
		id := "t" + strconv.Itoa(i)
		if n := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=? AND track_id=?`, u, id); n != 0 {
			t.Errorf("old track %q should be evicted, found %d", id, n)
		}
	}
	for i := 10; i < 60; i++ {
		id := "t" + strconv.Itoa(i)
		if n := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=? AND track_id=?`, u, id); n != 1 {
			t.Errorf("recent track %q should be retained, found %d", id, n)
		}
	}
	// The last-played track sits at position 1.
	var pos int
	if err := DB.QueryRow(`SELECT position FROM user_recent WHERE user_id=? AND track_id='t59'`, u).Scan(&pos); err != nil || pos != 1 {
		t.Errorf("newest track t59 should be position 1, got %d (err=%v)", pos, err)
	}

	// Replay an older retained track: it must jump to position 1, not be
	// duplicated, and history must still cap at 50.
	DbAddUserRecent(u, "t20")
	if got := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=?`, u); got != 50 {
		t.Errorf("after replay, user_recent has %d rows, want 50", got)
	}
	if err := DB.QueryRow(`SELECT position FROM user_recent WHERE user_id=? AND track_id='t20'`, u).Scan(&pos); err != nil || pos != 1 {
		t.Errorf("replayed t20 should be position 1, got %d (err=%v)", pos, err)
	}
}
