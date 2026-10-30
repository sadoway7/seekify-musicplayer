package desktopconfig

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func touch(t *testing.T, path string, modTime time.Time, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatal(err)
	}
}

func TestSyncToolsCopiesMissing(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	touch(t, filepath.Join(src, "yt-dlp.exe"), time.Now(), "new")

	n, err := SyncTools(src, dst)
	if err != nil || n != 1 {
		t.Fatalf("SyncTools = %d, %v; want 1, nil", n, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "yt-dlp.exe")); string(b) != "new" {
		t.Errorf("dst content = %q, want %q", b, "new")
	}
}

func TestSyncToolsUpdatesStale(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	now := time.Now()
	touch(t, filepath.Join(src, "ffmpeg.exe"), now.Add(time.Hour), "fresh")
	touch(t, filepath.Join(dst, "ffmpeg.exe"), now, "stale")

	if n, err := SyncTools(src, dst); n != 1 || err != nil {
		t.Fatalf("SyncTools = %d, %v; want 1, nil", n, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "ffmpeg.exe")); string(b) != "fresh" {
		t.Errorf("dst not refreshed: %q", b)
	}
}

func TestSyncToolsKeepsNewerDst(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	now := time.Now()
	touch(t, filepath.Join(src, "ffmpeg.exe"), now, "older-src")
	touch(t, filepath.Join(dst, "ffmpeg.exe"), now.Add(time.Hour), "newer-dst")

	if n, err := SyncTools(src, dst); n != 0 || err != nil {
		t.Fatalf("SyncTools = %d, %v; want 0, nil (yt-dlp -U result must survive)", n, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "ffmpeg.exe")); string(b) != "newer-dst" {
		t.Errorf("newer dst overwritten: %q", b)
	}
}

func TestSyncToolsNoOpWhenSrcMissing(t *testing.T) {
	n, err := SyncTools(filepath.Join(t.TempDir(), "nope"), t.TempDir())
	if n != 0 || err != nil {
		t.Fatalf("SyncTools with missing src = %d, %v; want 0, nil", n, err)
	}
}
