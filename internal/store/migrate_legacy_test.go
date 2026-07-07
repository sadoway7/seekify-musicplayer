package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// schemaLegacyMigration mirrors only the columns the migration touches, so we
// can verify data moves correctly without standing up the full InitDB.
const schemaLegacyMigration = `
CREATE TABLE favorites (track_id TEXT PRIMARY KEY, added_at INTEGER DEFAULT 0);
CREATE TABLE recent (track_id TEXT PRIMARY KEY, position INTEGER);
CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, user_id TEXT NOT NULL DEFAULT '');
CREATE TABLE download_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '');
CREATE TABLE user_favorites (user_id TEXT NOT NULL, track_id TEXT NOT NULL, added_at INTEGER DEFAULT 0, PRIMARY KEY (user_id, track_id));
CREATE TABLE user_recent (user_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER, PRIMARY KEY (user_id, track_id));
`

func setupMigrationTestDB(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	prevDB := DB
	DB = db
	t.Cleanup(func() {
		DB = prevDB
		db.Close()
	})
	if _, err := db.Exec(schemaLegacyMigration); err != nil {
		t.Fatalf("create schema: %v", err)
	}
}

// TestMigrateLegacyData verifies the upgrade path for an existing single-admin
// install: legacy favorites/playlists/download_jobs must move to the new first
// admin without loss or duplication, and the source tables stay intact. Legacy
// global `recent` is intentionally NOT migrated (it is unattributable
// pre-account data); any rows an earlier deploy already copied onto a user are
// cleared, while genuine logged-in plays are preserved.
func TestMigrateLegacyData(t *testing.T) {
	setupMigrationTestDB(t)

	// Seed legacy data (as an old DB would have it: no user_id concept).
	mustExec(t, `INSERT INTO favorites(track_id, added_at) VALUES ('t1', 100), ('t2', 200)`)
	mustExec(t, `INSERT INTO recent(track_id, position) VALUES ('t3', 1), ('t4', 2)`)
	mustExec(t, `INSERT INTO playlists(id, name, user_id) VALUES ('p1', 'Mine', ''), ('p2', 'Also Mine', '')`)
	mustExec(t, `INSERT INTO download_jobs(id, user_id) VALUES ('j1', ''), ('j2', '')`)

	// Simulate a prior deploy having copied legacy recent onto the admin, plus a
	// genuine logged-in play that must survive the cleanup.
	mustExec(t, `INSERT INTO user_recent(user_id, track_id, position) VALUES ('admin-001', 't3', 1), ('admin-001', 'genuine', 1)`)

	const admin = "admin-001"
	if err := MigrateLegacyDataTo(admin); err != nil {
		t.Fatalf("MigrateLegacyDataTo: %v", err)
	}

	// favorites migrated
	countFav := countT(t, `SELECT COUNT(*) FROM user_favorites WHERE user_id=?`, admin)
	if countFav != 2 {
		t.Errorf("user_favorites for admin = %d, want 2", countFav)
	}
	// recent NOT migrated; previously-migrated legacy rows cleared; genuine play kept
	countRec := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=?`, admin)
	if countRec != 1 {
		t.Errorf("user_recent for admin = %d, want 1 (only the genuine play)", countRec)
	}
	if n := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=? AND track_id='t3'`, admin); n != 0 {
		t.Errorf("migrated legacy recent 't3' should be cleared, got %d", n)
	}
	if n := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=? AND track_id='genuine'`, admin); n != 1 {
		t.Errorf("genuine recent play should be preserved, got %d", n)
	}
	// playlists re-owned
	ownedPlay := countT(t, `SELECT COUNT(*) FROM playlists WHERE user_id=?`, admin)
	if ownedPlay != 2 {
		t.Errorf("owned playlists = %d, want 2", ownedPlay)
	}
	// download_jobs re-owned
	ownedJobs := countT(t, `SELECT COUNT(*) FROM download_jobs WHERE user_id=?`, admin)
	if ownedJobs != 2 {
		t.Errorf("owned download_jobs = %d, want 2", ownedJobs)
	}
	// legacy tables preserved (migration source, not dropped)
	if n := countT(t, `SELECT COUNT(*) FROM favorites`); n != 2 {
		t.Errorf("legacy favorites should be preserved, got %d", n)
	}

	// Idempotency: running again must not duplicate or error.
	if err := MigrateLegacyDataTo(admin); err != nil {
		t.Fatalf("re-run MigrateLegacyDataTo: %v", err)
	}
	if got := countT(t, `SELECT COUNT(*) FROM user_favorites WHERE user_id=?`, admin); got != 2 {
		t.Errorf("idempotent re-run duplicated favorites: got %d, want 2", got)
	}
	if got := countT(t, `SELECT COUNT(*) FROM user_recent WHERE user_id=?`, admin); got != 1 {
		t.Errorf("idempotent re-run changed recent: got %d, want 1", got)
	}
}

// TestMigrateLegacyDataTwoUsersShareTrack confirms the composite PK lets two
// users favorite the same track without collision.
func TestMigrateLegacyDataTwoUsersShareTrack(t *testing.T) {
	setupMigrationTestDB(t)
	mustExec(t, `INSERT INTO favorites(track_id, added_at) VALUES ('shared', 1)`)

	// First admin migrates the legacy row.
	if err := MigrateLegacyDataTo("admin"); err != nil {
		t.Fatal(err)
	}
	// A second user independently favorites the same track: must not collide.
	if _, err := DB.Exec(`INSERT INTO user_favorites(user_id, track_id, added_at) VALUES ('bob', 'shared', 2)`); err != nil {
		t.Fatalf("second user favorite collision: %v", err)
	}
	if n := countT(t, `SELECT COUNT(*) FROM user_favorites WHERE track_id='shared'`); n != 2 {
		t.Errorf("expected 2 users owning 'shared', got %d", n)
	}
}

func mustExec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := DB.Exec(q, args...); err != nil {
		t.Fatalf("exec %q: %v", q, err)
	}
}

func countT(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := DB.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", q, err)
	}
	return n
}
