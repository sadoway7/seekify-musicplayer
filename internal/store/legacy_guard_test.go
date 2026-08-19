package store

import (
	"testing"
)

// TestMigrateLegacyDataOneShotGuard verifies the legacy_data_migrated settings
// guard: the migration runs at most once. Without it, every boot re-owns
// runtime-created shared playlists (user_id='', created by watched-playlist
// sync) to the first admin, hiding them from every other user.
func TestMigrateLegacyDataOneShotGuard(t *testing.T) {
	setupMigrationTestDB(t)
	mustExec(t, `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`)

	// Pre-account playlist: the one legitimate migration target.
	mustExec(t, `INSERT INTO playlists(id, name, user_id) VALUES ('legacy', 'Old Global', '')`)
	if err := MigrateLegacyDataTo("admin"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if got := countT(t, `SELECT COUNT(*) FROM playlists WHERE id='legacy' AND user_id='admin'`); got != 1 {
		t.Fatalf("legacy playlist should be owned by admin after first run, got %d", got)
	}

	// Shared playlist created at runtime (post-migration), like watched.go does.
	mustExec(t, `INSERT INTO playlists(id, name, user_id) VALUES ('shared', 'Watched Mix', '')`)

	// Next boot (or any later call): guard must skip — the shared playlist
	// stays unowned and visible to everyone.
	if err := MigrateLegacyDataTo("admin"); err != nil {
		t.Fatalf("second run: %v", err)
	}
	var owner string
	if err := DB.QueryRow(`SELECT user_id FROM playlists WHERE id='shared'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != "" {
		t.Fatalf("shared playlist was re-owned to %q; guard failed to make migration one-shot", owner)
	}
}
