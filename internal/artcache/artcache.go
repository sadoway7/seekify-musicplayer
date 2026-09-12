// Package artcache holds derivative WebP copies of library artwork so
// clients download small files while the originals stay untouched on disk.
// Conversion is lazy and best-effort: the original is always served the
// moment a derivative is missing, stale, or the tool to make one is absent.
package artcache

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"musicapp/internal/downloads"
	"musicapp/internal/store"
)

// Dir returns the derived-art directory (data/artcache).
func Dir() string {
	return filepath.Join(filepath.Dir(store.DBPath), "artcache")
}

// Path returns the derivative path for a class ("covers", "artists") and
// base filename (e.g. "a373a4e49f7d.jpg" → ".../covers/a373a4e49f7d.jpg.webp").
func Path(class, base string) string {
	return filepath.Join(Dir(), class, base+".webp")
}

// AcceptsWebp reports whether the client advertises WebP support. All modern
// browsers send it on every image request; absence (curl, legacy clients)
// keeps byte-identical legacy behavior.
func AcceptsWebp(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "image/webp")
}

// Fresh reports whether the derivative exists and is at least as new as its
// source (same mtime rule as the transcode cache).
func Fresh(webpPath, srcPath string) bool {
	ci, err := os.Stat(webpPath)
	if err != nil {
		return false
	}
	si, err := os.Stat(srcPath)
	if err != nil {
		return false
	}
	return !ci.ModTime().Before(si.ModTime())
}

// available caches the libwebp probe so startup can confess — in the logs —
// whether derivatives will actually be produced on this deployment.
var available struct {
	sync.Once
	val bool
}

// Available reports whether this ffmpeg can encode WebP.
func Available() bool {
	available.Do(func() {
		ff := findFfmpeg()
		if ff == "" {
			return
		}
		out, err := exec.Command(ff, "-hide_banner", "-encoders").CombinedOutput()
		available.val = err == nil && strings.Contains(string(out), "libwebp")
	})
	return available.val
}

// findFfmpeg locates the ffmpeg binary (PATH first, then common install dirs).
func findFfmpeg() string {
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

// ConvertAsync rewrites the derivative in the background at low priority.
// Callers must have already served the original — conversion is best-effort
// and never blocks a request or surfaces an error to the client. Concurrent
// requests for the same derivative dedupe (a page of cold covers must not
// stampede identical encodes).
var inFlight sync.Map

func ConvertAsync(webpPath, srcPath string) {
	if _, loaded := inFlight.LoadOrStore(webpPath, struct{}{}); loaded {
		return
	}
	store.SafeGo("artcache-convert", func() {
		defer inFlight.Delete(webpPath)
		_ = EnsureSync(webpPath, srcPath)
	})
}

// EnsureSync converts src to a ≤1000px WebP at the derivative path, only
// ever downscaling. A missing ffmpeg (or one without libwebp) is an error —
// callers serve the original in that case.
func EnsureSync(webpPath, srcPath string) error {
	if Fresh(webpPath, srcPath) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(webpPath), 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	tmp := webpPath + ".tmp"
	_ = os.Remove(tmp) // stale tmp from a crashed run
	// Only-downscale: never enlarge small art. -q:v 70 ≈ visually identical
	// at UI render sizes.
	args := []string{
		"-y", "-hide_banner", "-loglevel", "error",
		"-i", srcPath,
		"-vf", "scale='min(1000,iw)':'min(1000,ih)':force_original_aspect_ratio=decrease",
		"-c:v", "libwebp", "-q:v", "70",
		// Explicit muxer: the tmp filename has no recognized extension.
		"-f", "webp",
		tmp,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := downloads.NicedFfmpegCommandContext(ctx, args...)
	if cmd == nil {
		return fmt.Errorf("ffmpeg not found")
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("ffmpeg: %w: %s", err, string(out))
	}
	return os.Rename(tmp, webpPath)
}
