package downloads

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestDecodeCheckAudio verifies the ffmpeg decode probe distinguishes clean
// files from corrupt ones. Skips when ffmpeg is absent (graceful degradation),
// mirroring production behavior on hosts without ffmpeg.
func TestDecodeCheckAudio(t *testing.T) {
	if FindFfmpeg() == "" {
		t.Skip("ffmpeg not installed; decode check degrades gracefully")
	}
	dir := t.TempDir()

	// 1) A valid silent WAV decodes cleanly → 0 errors.
	clean := filepath.Join(dir, "clean.wav")
	if out, err := exec.Command(FindFfmpeg(), "-y", "-f", "lavfi",
		"-i", "anullsrc=r=8000:cl=mono", "-t", "1", clean).CombinedOutput(); err != nil {
		t.Fatalf("generate clean wav: %v\n%s", err, out)
	}
	if n, first := DecodeCheckAudio(clean); n != 0 {
		t.Errorf("clean file: got %d decode errors (first=%q), want 0", n, first)
	}

	// 2) Garbage bytes with an audio extension → ffmpeg must report errors.
	corrupt := filepath.Join(dir, "corrupt.mp3")
	if err := os.WriteFile(corrupt, []byte("ID3\x04not actually audio data at all"), 0644); err != nil {
		t.Fatal(err)
	}
	if n, _ := DecodeCheckAudio(corrupt); n < 1 {
		t.Errorf("corrupt file: got %d decode errors, want >= 1", n)
	}

	// 3) Empty path / missing file must not panic — returns 0 (treated as clean,
	// since callers already gate on file existence).
	if n, _ := DecodeCheckAudio(filepath.Join(dir, "nope.wav")); n != 0 {
		t.Errorf("missing file: got %d errors, want 0 (no panic)", n)
	}
}
