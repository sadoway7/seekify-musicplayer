package artcache

import (
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"musicapp/internal/store"
)

func findFF() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	for _, p := range []string{"/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// hasLibWebP reports whether this ffmpeg can encode WebP. A build without
// libwebp is exactly the runtime case where originals are served instead.
func hasLibWebP() bool {
	ff := findFF()
	if ff == "" {
		return false
	}
	out, err := exec.Command(ff, "-hide_banner", "-encoders").CombinedOutput()
	return err == nil && strings.Contains(string(out), "libwebp")
}

func TestAcceptsWebp(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/cover/x", nil)
	req.Header.Set("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
	if !AcceptsWebp(req) {
		t.Fatal("browser-style Accept must accept webp")
	}
	plain := httptest.NewRequest("GET", "/api/cover/x", nil)
	if AcceptsWebp(plain) {
		t.Fatal("no Accept header must not accept webp (legacy behavior)")
	}
}

func TestEnsureSyncDownscalesAndRespectsFreshness(t *testing.T) {
	if findFF() == "" {
		t.Skip("ffmpeg not available")
	}
	if !hasLibWebP() {
		t.Skip("ffmpeg lacks libwebp — runtime serves originals (graceful path)")
	}
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "data.db"))
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})

	dir := t.TempDir()
	src := filepath.Join(dir, "cover.jpg")
	gen := exec.Command(findFF(), "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=size=1200x800", "-frames:v", "1", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate jpeg: %v: %s", err, out)
	}

	webp := Path("covers", "cover.jpg")
	if err := EnsureSync(webp, src); err != nil {
		t.Fatalf("convert: %v", err)
	}
	info, err := os.Stat(webp)
	if err != nil {
		t.Fatalf("webp missing: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("webp is empty")
	}
	if !Fresh(webp, src) {
		t.Fatal("fresh derivative must report Fresh")
	}

	// Newer source (re-tagged/replaced art) invalidates the derivative.
	future := info.ModTime().Add(2 * time.Hour)
	if err := os.Chtimes(src, future, future); err != nil {
		t.Fatal(err)
	}
	if Fresh(webp, src) {
		t.Fatal("stale derivative must not report Fresh")
	}
	if err := EnsureSync(webp, src); err != nil {
		t.Fatalf("reconvert: %v", err)
	}
	if !Fresh(webp, src) {
		t.Fatal("reconverted derivative must be Fresh again")
	}
	if !strings.HasSuffix(webp, ".webp") {
		t.Fatalf("derivative path = %q, want .webp suffix", webp)
	}
}
