package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

// findFF locates ffmpeg for integration tests (mirrors transcode.findFfmpeg).
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

func TestNeedsTranscode(t *testing.T) {
	cases := map[string]bool{
		".flac": true,
		".opus": true,
		".ogg":  true,
		".wav":  true,
		".mp3":  false,
		".m4a":  false,
		".aac":  false,
		".wma":  false,
	}
	for ext, want := range cases {
		if got := needsTranscode(ext); got != want {
			t.Errorf("needsTranscode(%q) = %v, want %v", ext, got, want)
		}
	}
}

// setupTranscodeTestDB swaps in a fresh temp DB (seeded with settings) and
// restores the previous global DB on cleanup.
func setupTranscodeTestDB(t *testing.T) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "data.db"))
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})
}

func withTrack(t *testing.T, filename string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, filename), []byte("fake audio data"), 0o644); err != nil {
		t.Fatal(err)
	}
	store.Mu.Lock()
	prevTracks := store.Tracks
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: filename},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.MusicDir = prevMusicDir
		store.Mu.Unlock()
	})
}

func TestStreamHandlerNoTranscodeWithoutFmt(t *testing.T) {
	setupTranscodeTestDB(t)
	withTrack(t, "track.flac")

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/flac" {
		t.Fatalf("Content-Type = %q, want audio/flac (raw file must be served without fmt=aac)", ct)
	}
}

func TestStreamHandlerFmtAacFallbackOnTranscodeFailure(t *testing.T) {
	setupTranscodeTestDB(t)
	withTrack(t, "track.flac")

	// The source is fake audio data — ffmpeg (if present) fails on it, and if
	// ffmpeg is absent the lookup fails. Either way Ensure errors and the raw
	// file must be served (graceful degradation).
	req := httptest.NewRequest(http.MethodGet, "/api/stream/track?fmt=aac", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (raw fallback)", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/flac" {
		t.Fatalf("Content-Type = %q, want audio/flac (transcode-failure fallback)", ct)
	}
}

func TestStreamHandlerFmtAacForPlayableExt(t *testing.T) {
	setupTranscodeTestDB(t)
	withTrack(t, "track.mp3")

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track?fmt=aac", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// mp3 is natively playable on Safari — must NOT be transcoded.
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Fatalf("Content-Type = %q, want audio/mpeg (playable ext must be served raw)", ct)
	}
}

func TestStreamHandlerFmtAacRealTranscode(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	setupTranscodeTestDB(t)

	// Build a small real FLAC with ffmpeg, then stream it with fmt=aac.
	dir := t.TempDir()
	src := filepath.Join(dir, "track.flac")
	gen := exec.Command(ff, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:a", "flac", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate flac: %v: %s", err, out)
	}

	store.Mu.Lock()
	prevTracks := store.Tracks
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.flac"},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.MusicDir = prevMusicDir
		store.Mu.Unlock()
	})

	// Range request through the transcode path — must return the cached m4a.
	req := httptest.NewRequest(http.MethodGet, "/api/stream/track?fmt=aac", nil)
	req.Header.Set("Range", "bytes=0-99")
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mp4" {
		t.Fatalf("Content-Type = %q, want audio/mp4 (transcoded)", ct)
	}
	if n := len(rec.Body.Bytes()); n != 100 {
		t.Fatalf("body bytes = %d, want 100", n)
	}

	// Cache file must exist and be a valid m4a.
	cachePath := filepath.Join(filepath.Dir(store.DBPath), "transcode", "track.m4a")
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}
	probe := exec.Command(ff, "-v", "error", "-i", cachePath, "-f", "null", "-")
	if out, err := probe.CombinedOutput(); err != nil {
		t.Fatalf("cached m4a fails ffprobe: %v: %s", err, out)
	}
}

// Real ALAC-in-m4a must be transcoded even WITHOUT fmt=aac: Chrome claims
// m4a support via canPlayType but cannot decode ALAC (DEMUXER_ERROR).
// Real AAC m4a must keep serving raw. Both skip when ffmpeg is absent.
// Handler-level regression with a real production "Spatial Audio" file
// (E-AC-3 in m4a). Skips when SEEKIFY_SPATIAL_M4A is not set.
func TestStreamHandlerSpatialAudioForcesTranscode(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	path := os.Getenv("SEEKIFY_SPATIAL_M4A")
	if path == "" {
		t.Skip("SEEKIFY_SPATIAL_M4A not set")
	}
	setupTranscodeTestDB(t)

	dir := t.TempDir()
	src := filepath.Join(dir, "track.m4a")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, data, 0o644); err != nil {
		t.Fatal(err)
	}

	store.Mu.Lock()
	prevTracks := store.Tracks
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.MusicDir = prevMusicDir
		store.Mu.Unlock()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mp4" {
		t.Fatalf("Content-Type = %q, want audio/mp4 (transcoded)", ct)
	}
	cachePath := filepath.Join(filepath.Dir(store.DBPath), "transcode", "track.m4a")
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("spatial-audio file was not transcoded (cache missing): %v", err)
	}
	probe := exec.Command(ff, "-v", "error", "-i", cachePath, "-f", "null", "-")
	if out, err := probe.CombinedOutput(); err != nil {
		t.Fatalf("transcoded m4a fails ffprobe: %v: %s", err, out)
	}
}

func TestStreamHandlerALACForcesTranscode(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	setupTranscodeTestDB(t)

	dir := t.TempDir()
	src := filepath.Join(dir, "track.m4a")
	gen := exec.Command(ff, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:a", "alac", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate alac m4a: %v: %s", err, out)
	}

	store.Mu.Lock()
	prevTracks := store.Tracks
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.MusicDir = prevMusicDir
		store.Mu.Unlock()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track", nil) // no fmt param
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mp4" {
		t.Fatalf("Content-Type = %q, want audio/mp4", ct)
	}
	cachePath := filepath.Join(filepath.Dir(store.DBPath), "transcode", "track.m4a")
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("ALAC was not transcoded (cache missing): %v", err)
	}
	probe := exec.Command(ff, "-v", "error", "-i", cachePath, "-f", "null", "-")
	if out, err := probe.CombinedOutput(); err != nil {
		t.Fatalf("transcoded m4a fails ffprobe: %v: %s", err, out)
	}
}

func TestStreamHandlerAACm4aServedRaw(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	setupTranscodeTestDB(t)

	dir := t.TempDir()
	src := filepath.Join(dir, "track.m4a")
	gen := exec.Command(ff, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:a", "aac", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate aac m4a: %v: %s", err, out)
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}

	store.Mu.Lock()
	prevTracks := store.Tracks
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.Tracks = map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.MusicDir = prevMusicDir
		store.Mu.Unlock()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.Bytes(); !bytes.Equal(got, raw) {
		t.Fatal("AAC m4a was transcoded/served from cache — must be served byte-identical raw")
	}
	cachePath := filepath.Join(filepath.Dir(store.DBPath), "transcode", "track.m4a")
	if _, err := os.Stat(cachePath); err == nil {
		t.Fatal("transcode cache created for plain AAC m4a")
	}
}

func TestTranscodeWarmHandler(t *testing.T) {
	setupTranscodeTestDB(t)
	withTrack(t, "track.mp3")

	// Wrong method → 405.
	req := httptest.NewRequest(http.MethodGet, "/api/transcode-warm/track", nil)
	rec := httptest.NewRecorder()
	TranscodeWarmHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d, want 405", rec.Code)
	}

	// Unknown track → 404.
	req = httptest.NewRequest(http.MethodPost, "/api/transcode-warm/nope", nil)
	rec = httptest.NewRecorder()
	TranscodeWarmHandler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown track status = %d, want 404", rec.Code)
	}

	// Playable ext (mp3) → ready immediately, no transcode kicked off.
	req = httptest.NewRequest(http.MethodPost, "/api/transcode-warm/track", nil)
	rec = httptest.NewRecorder()
	TranscodeWarmHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mp3 status = %d, want 200", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"ready":true}` {
		t.Fatalf("mp3 body = %q, want ready:true", got)
	}
}
