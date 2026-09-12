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
	"path/filepath"
	"strings"
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

// ConvertAsync rewrites the derivative in the background at low priority.
// Callers must have already served the original — conversion is best-effort
// and never blocks a request or surfaces an error to the client.
func ConvertAsync(webpPath, srcPath string) {
	store.SafeGo("artcache-convert", func() { _ = EnsureSync(webpPath, srcPath) })
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
