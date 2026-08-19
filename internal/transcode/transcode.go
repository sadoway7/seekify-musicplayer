// Package transcode provides on-demand FLAC→AAC transcoding for browsers
// that cannot stream FLAC (iOS/macOS Safari buffers the whole file before
// playing, which makes large FLACs take tens of seconds to start).
//
// The client probes canPlayType() and requests ?fmt=aac for unsupported
// formats; StreamHandler serves a cached .m4a (moov-first via +faststart,
// fully Range-seekable) instead of the raw file. Desktop browsers keep
// getting the original FLAC untouched.
package transcode

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"musicapp/internal/downloads"
	"musicapp/internal/store"
)

var (
	singleflightMu sync.Mutex
	inFlight       = map[string]chan struct{}{}

	// transSem bounds concurrent ffmpeg passes (mirrors normSem/waveSem).
	transSem = make(chan struct{}, 2)

	// Ceiling on a single encode. Without it a wedged ffmpeg (stalled NFS
	// mount, pathological input) holds a sem slot forever; two wedges kill
	// transcoding for the process lifetime and every Safari stream request
	// blocks as a singleflight waiter. Var (not const) so tests can shrink it.
	ensureTimeout = 10 * time.Minute
)

// cacheDir returns the on-disk transcode cache directory (data/transcode).
func cacheDir() string {
	return filepath.Join(filepath.Dir(store.DBPath), "transcode")
}

// CachePath returns the cached .m4a path for a track ID.
func CachePath(trackID string) string {
	return filepath.Join(cacheDir(), trackID+".m4a")
}

// findFfmpeg locates the ffmpeg binary (PATH first, then common install dirs).
func findFfmpeg() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	for _, p := range []string{
		"/opt/homebrew/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/usr/bin/ffmpeg",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// IsReady reports whether a fresh cached transcode exists for the source
// file. Fresh = cache mtime >= source mtime, so re-downloaded/re-tagged
// files invalidate their cache entry automatically.
func IsReady(trackID, sourcePath string) bool {
	ci, err := os.Stat(CachePath(trackID))
	if err != nil {
		return false
	}
	si, err := os.Stat(sourcePath)
	if err != nil {
		return false
	}
	return !ci.ModTime().Before(si.ModTime())
}

// Ensure returns the path to a fresh cached .m4a for the track, transcoding
// on miss. Concurrent calls for the same track dedupe via singleflight: the
// loser waits on the winner's done channel, then returns the cached path.
// Returns ("", err) if ffmpeg is absent or the transcode fails — callers
// fall back to serving the raw file. Runs at normal priority: callers on the
// foreground playback path (StreamHandler blocks on it) need the CPU.
func Ensure(trackID, sourcePath string) (string, error) {
	return ensure(trackID, sourcePath, false)
}

// EnsureLow is Ensure at background CPU priority (nice -n 19). Used by the
// next-track prewarm: a warm encode must never steal CPU from a foreground
// play encode racing it — that race was the "sometimes songs don't play" on
// Safari (foreground encode slowed past the client's load timeout).
func EnsureLow(trackID, sourcePath string) (string, error) {
	return ensure(trackID, sourcePath, true)
}

func ensure(trackID, sourcePath string, lowPriority bool) (string, error) {
	if IsReady(trackID, sourcePath) {
		return CachePath(trackID), nil
	}
	ff := findFfmpeg()
	if ff == "" {
		return "", fmt.Errorf("ffmpeg not found")
	}

	// Singleflight: become the worker or wait for an existing one.
	singleflightMu.Lock()
	if done, ok := inFlight[trackID]; ok {
		singleflightMu.Unlock()
		<-done
		if IsReady(trackID, sourcePath) {
			return CachePath(trackID), nil
		}
		return "", fmt.Errorf("transcode failed")
	}
	done := make(chan struct{})
	inFlight[trackID] = done
	singleflightMu.Unlock()

	defer func() {
		close(done)
		singleflightMu.Lock()
		delete(inFlight, trackID)
		singleflightMu.Unlock()
	}()

	// Double-check after acquiring leadership: a concurrent goroutine may
	// have completed the work while we waited for the lock.
	if IsReady(trackID, sourcePath) {
		return CachePath(trackID), nil
	}

	transSem <- struct{}{}
	defer func() { <-transSem }()

	bitrate := store.GetSetting("transcode_bitrate", "192")
	if _, err := strconv.Atoi(bitrate); err != nil {
		bitrate = "192"
	}

	if err := os.MkdirAll(cacheDir(), 0o755); err != nil {
		return "", fmt.Errorf("mkdir cache: %w", err)
	}
	tmp := CachePath(trackID) + ".tmp"
	os.Remove(tmp) // stale tmp from a crashed run

	args := []string{
		"-y",
		"-hide_banner", "-loglevel", "error",
		"-i", sourcePath,
		"-vn",
		"-c:a", "aac",
		"-b:a", bitrate+"k",
		"-movflags", "+faststart",
		// Explicit muxer: the temp filename has no recognized extension, so
		// ffmpeg can't infer the container from it.
		"-f", "ipod",
		tmp,
	}
	ctx, cancel := context.WithTimeout(context.Background(), ensureTimeout)
	defer cancel()
	var cmd *exec.Cmd
	if lowPriority {
		cmd = downloads.NicedFfmpegCommandContext(ctx, args...)
		if cmd == nil {
			return "", fmt.Errorf("ffmpeg not found")
		}
	} else {
		cmd = exec.CommandContext(ctx, ff, args...)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmp)
		log.Printf("[transcode] %s: %v: %s", trackID, err, string(out))
		return "", fmt.Errorf("ffmpeg: %w", err)
	}
	if err := os.Rename(tmp, CachePath(trackID)); err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("rename: %w", err)
	}
	log.Printf("[transcode] %s: cached (%sk)", trackID, bitrate)
	return CachePath(trackID), nil
}

// PruneCache removes cache entries untouched for maxAge, then enforces a
// total size cap (oldest first). Runs on a timer in server.go.
func PruneCache() {
	dir := cacheDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	const (
		maxAge  = 30 * 24 * time.Hour
		sizeCap = int64(2 * 1024 * 1024 * 1024) // 2 GB
	)
	cutoff := time.Now().Add(-maxAge)

	type fileInfo struct {
		path string
		size int64
		at   time.Time
	}
	var files []fileInfo
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if filepath.Ext(e.Name()) == ".tmp" {
			// Leftover from a crashed transcode — but the prune ticker can
			// fire while an encode is mid-write (encode writes CachePath+".tmp"
			// for its whole duration), so only remove tmps that predate any
			// legitimate in-flight encode. ensureTimeout bounds legit runs.
			if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > time.Hour {
				os.Remove(filepath.Join(dir, e.Name()))
			}
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		p := filepath.Join(dir, e.Name())
		total += info.Size()
		// ponytail: mtime as the recency proxy; atime is unreliable across
		// filesystems and enabling it server-wide is not worth it here.
		files = append(files, fileInfo{p, info.Size(), info.ModTime()})
	}

	// 1) age-based purge
	kept := files[:0]
	for _, f := range files {
		if f.at.Before(cutoff) {
			if err := os.Remove(f.path); err == nil {
				total -= f.size
			}
		} else {
			kept = append(kept, f)
		}
	}
	// 2) size cap, oldest first
	if total > sizeCap {
		sort.Slice(kept, func(i, j int) bool { return kept[i].at.Before(kept[j].at) })
		for _, f := range kept {
			if total <= sizeCap {
				break
			}
			if err := os.Remove(f.path); err == nil {
				total -= f.size
			}
		}
	}
}
