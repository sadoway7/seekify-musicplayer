package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestSnapshotDB covers the boot-time safety copy: no-op when the source DB
// doesn't exist (first boot), db+wal copied when they do, a second call makes
// a second copy, and backups older than the retention window are pruned.
func TestSnapshotDB(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "music.db")

	// First boot: source doesn't exist — silent no-op, no backups dir created.
	SnapshotDB(dbPath)
	if _, err := os.Stat(filepath.Join(dir, "backups")); !os.IsNotExist(err) {
		t.Fatalf("backups dir should not exist on first boot, stat err=%v", err)
	}

	// Existing DB + WAL: both get copied.
	if err := os.WriteFile(dbPath, []byte("db-bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-wal", []byte("wal-bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	SnapshotDB(dbPath)
	files := globSnapshots(t, dir)
	if len(files) != 2 {
		t.Fatalf("after first snapshot want 2 files (db+wal), got %v", files)
	}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		want := "db-bytes"
		if strings.HasSuffix(f, "-wal") {
			want = "wal-bytes"
		}
		if string(data) != want {
			t.Fatalf("%s content = %q, want %q", f, data, want)
		}
	}

	// Second call creates another snapshot (distinct timestamp).
	time.Sleep(1100 * time.Millisecond) // timestamp resolution is 1s
	SnapshotDB(dbPath)
	if files = globSnapshots(t, dir); len(files) != 4 {
		t.Fatalf("after second snapshot want 4 files, got %v", files)
	}

	// Retention: a backup older than 7 days is pruned, current ones stay.
	old := filepath.Join(dir, "backups", "music-20200101-000000.db")
	if err := os.WriteFile(old, nil, 0644); err != nil {
		t.Fatal(err)
	}
	stale := time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(old, stale, stale); err != nil {
		t.Fatal(err)
	}
	SnapshotDB(dbPath)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("8-day-old backup should be pruned, stat err=%v", err)
	}
	if files = globSnapshots(t, dir); len(files) != 4 {
		t.Fatalf("recent backups should survive pruning, got %v", files)
	}
}

func globSnapshots(t *testing.T, dir string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(dir, "backups", "music-*.db*"))
	if err != nil {
		t.Fatal(err)
	}
	return files
}
