package downloads

import (
	"os"
	"path/filepath"
	"testing"
)

func TestToolFallbackPathsWindowsLayout(t *testing.T) {
	exeDir := filepath.Join("C:", "Programs", "Seekify")
	appData := filepath.Join("C:", "Users", "me", "AppData", "Roaming")

	got := toolFallbackPaths("ffmpeg.exe", exeDir, appData)

	want := []string{
		filepath.Join(exeDir, "tools", "ffmpeg.exe"),
		filepath.Join(appData, "Seekify", "bin", "ffmpeg.exe"),
	}
	if len(got) != len(want) {
		t.Fatalf("toolFallbackPaths returned %d paths, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("path[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestFindBinaryMissingToolsReturnsEmpty(t *testing.T) {
	// Nothing exists at these paths — playback-only install must find no
	// tool and keep working (graceful degradation).
	if p := FindBinary("yt-dlp", "/nonexistent/tools/yt-dlp", "/nonexistent/bin/yt-dlp"); p != "" {
		t.Errorf("FindBinary with only missing fallbacks = %q, want empty", p)
	}
}

func TestFindBinaryPrefersExistingFallback(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "yt-dlp")
	if err := writeFile(exe); err != nil {
		t.Fatal(err)
	}
	if p := FindBinary("yt-dlp", exe, "/nonexistent/other"); p != exe {
		t.Errorf("FindBinary = %q, want %q", p, exe)
	}
}

func writeFile(path string) error {
	return os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755)
}
