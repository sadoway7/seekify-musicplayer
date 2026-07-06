package downloads

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"musicapp/internal/store"

	_ "modernc.org/sqlite"
)

const limitsSchema = `
CREATE TABLE download_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '');
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
`

func setupLimitsTestDB(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	prevDB := store.DB
	store.DB = db
	t.Cleanup(func() {
		store.DB = prevDB
		db.Close()
	})
	if _, err := db.Exec(limitsSchema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
}

func TestEnforceDownloadLimits(t *testing.T) {
	setupLimitsTestDB(t)

	// No limits set → unlimited.
	if err := EnforceDownloadLimits("u1"); err != nil {
		t.Fatalf("unlimited should pass: %v", err)
	}

	// Per-user limit = 2. Two queued jobs fills the budget.
	store.SetSetting("download_limit_per_user", "2")
	insertJob(t, "j1", "u1", "queued")
	insertJob(t, "j2", "u1", "queued")
	if err := EnforceDownloadLimits("u1"); !errors.Is(err, ErrDownloadLimit) {
		t.Fatalf("expected ErrDownloadLimit at per-user cap, got %v", err)
	}
	// A different user is unaffected by u1's budget.
	if err := EnforceDownloadLimits("u2"); err != nil {
		t.Fatalf("u2 should pass: %v", err)
	}
	// Completed jobs don't count toward the budget.
	insertJob(t, "j3", "u1", "completed")
	if err := EnforceDownloadLimits("u1"); !errors.Is(err, ErrDownloadLimit) {
		t.Fatalf("completed job must not free budget; got %v", err)
	}
	mustSetStatus(t, "j1", "failed")
	if err := EnforceDownloadLimits("u1"); err != nil {
		t.Fatalf("after j1→failed budget frees: %v", err)
	}

	// Global limit applies across all users.
	store.SetSetting("download_limit_global", "1")
	insertJob(t, "g1", "u-other", "queued")
	if err := EnforceDownloadLimits("u2"); !errors.Is(err, ErrDownloadLimit) {
		t.Fatalf("expected ErrDownloadLimit at global cap, got %v", err)
	}

	// Blank userID (system job) skips per-user but still honors global.
	store.SetSetting("download_limit_global", "0")
	if err := EnforceDownloadLimits(""); err != nil {
		t.Fatalf("system job unlimited should pass: %v", err)
	}
}

func insertJob(t *testing.T, id, userID, status string) {
	t.Helper()
	if _, err := store.DB.Exec(
		`INSERT INTO download_jobs(id, status, user_id) VALUES (?, ?, ?)`, id, status, userID); err != nil {
		t.Fatalf("insert job: %v", err)
	}
}

func mustSetStatus(t *testing.T, id, status string) {
	t.Helper()
	if _, err := store.DB.Exec(`UPDATE download_jobs SET status=? WHERE id=?`, status, id); err != nil {
		t.Fatalf("set status: %v", err)
	}
}
