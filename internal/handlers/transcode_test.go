package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"musicapp/internal/models"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
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
	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: filename},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
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

	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.flac"},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
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

	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
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

	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
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

	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.m4a"},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
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

// setupRealFLAC swaps in a temp library containing one real 2s sine FLAC
// (skips the caller's test when ffmpeg is absent) and restores globals.
func setupRealFLAC(t *testing.T) string {
	t.Helper()
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "track.flac")
	gen := exec.Command(ff, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:a", "flac", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate flac: %v: %s", err, out)
	}
	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	prevMusicDir := store.MusicDir
	store.MusicDir = dir
	store.ReplaceLibrary(map[string]*models.Track{
		"track": {ID: "track", FilePath: "track.flac"},
	}, nil)
	t.Cleanup(func() {
		store.ReplaceLibrary(prevTracks, nil)
		store.MusicDir = prevMusicDir
	})
	return src
}

// b=128 gets its own cache file (<id>-128.m4a). A garbage b rides the
// legacy default path (<id>.m4a) — same as sending no b at all.
func TestStreamHandlerBitrateCacheNaming(t *testing.T) {
	setupTranscodeTestDB(t)
	setupRealFLAC(t)

	req := httptest.NewRequest(http.MethodGet, "/api/stream/track?fmt=aac&b=128", nil)
	rec := httptest.NewRecorder()
	StreamHandler(rec, req)
	if rec.Code != http.StatusOK && rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 200/206, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mp4" {
		t.Fatalf("Content-Type = %q, want audio/mp4", ct)
	}
	cacheDir := filepath.Join(filepath.Dir(store.DBPath), "transcode")
	if _, err := os.Stat(filepath.Join(cacheDir, "track-128.m4a")); err != nil {
		t.Fatalf("128k cache file missing: %v", err)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/stream/track?fmt=aac&b=banana", nil)
	rec2 := httptest.NewRecorder()
	StreamHandler(rec2, req2)
	if ct := rec2.Header().Get("Content-Type"); ct != "audio/mp4" {
		t.Fatalf("Content-Type = %q, want audio/mp4 (garbage b must still transcode)", ct)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "track.m4a")); err != nil {
		t.Fatalf("default-bitrate cache file missing: %v", err)
	}
}

// The warm endpoint must honor ?b=128: a fresh 128k copy reports ready
// without re-encoding, while the default copy is reported as warming.
func TestTranscodeWarmHandlerHonorsBitrate(t *testing.T) {
	setupTranscodeTestDB(t)
	src := setupRealFLAC(t)

	if _, err := transcode.EnsureAt("track", src, "128"); err != nil {
		t.Fatalf("pre-encode 128k copy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/transcode-warm/track?b=128", nil)
	rec := httptest.NewRecorder()
	TranscodeWarmHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"ready":true}` {
		t.Fatalf("body = %q, want {\"ready\":true} (128k copy already fresh)", body)
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/transcode-warm/track", nil)
	rec2 := httptest.NewRecorder()
	TranscodeWarmHandler(rec2, req2)
	if body := strings.TrimSpace(rec2.Body.String()); body != `{"ready":false}` {
		t.Fatalf("body = %q, want {\"ready\":false} (default copy not yet cached)", body)
	}
}

// WebP derivative lifecycle on the cover path: first webp-accepting request
// serves the original jpeg and kicks a background convert; once the
// derivative lands, webp-accepting clients get image/webp with a c3- ETag;
// clients without Accept keep byte-identical legacy behavior.
func TestCoverHandlerWebPDerivative(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	out, err := exec.Command(ff, "-hide_banner", "-encoders").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "libwebp") {
		t.Skip("ffmpeg lacks libwebp — runtime serves originals (graceful path)")
	}
	setupTranscodeTestDB(t)
	setupRealFLAC(t) // reuses the library-swap helper; source name unused

	// Real JPEG cover on disk for album "album".
	imagesDir := filepath.Join(store.MusicDir, "images")
	if err := os.MkdirAll(imagesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	coverPath := filepath.Join(imagesDir, "album.jpg")
	gen := exec.Command(ff, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=size=1200x800", "-frames:v", "1", coverPath)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("generate cover: %v: %s", err, out)
	}

	// 1) webp-accepting client: first response is the original jpeg while
	// the derivative converts in the background.
	req := httptest.NewRequest(http.MethodGet, "/api/cover/album", nil)
	req.Header.Set("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
	rec := httptest.NewRecorder()
	CoverHandler(rec, req)
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("first response Content-Type = %q, want image/jpeg (serve-through)", ct)
	}

	// 2) derivative lands in the background.
	webpPath := filepath.Join(filepath.Dir(store.DBPath), "artcache", "covers", "album.jpg.webp")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(webpPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("webp derivative never appeared")
		}
		time.Sleep(50 * time.Millisecond)
	}

	// 3) now webp clients get image/webp under a c3- ETag; jpeg clients
	// keep the legacy c2 response untouched.
	req2 := httptest.NewRequest(http.MethodGet, "/api/cover/album", nil)
	req2.Header.Set("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
	rec2 := httptest.NewRecorder()
	CoverHandler(rec2, req2)
	if ct := rec2.Header().Get("Content-Type"); ct != "image/webp" {
		t.Fatalf("second response Content-Type = %q, want image/webp", ct)
	}
	if etag := rec2.Header().Get("ETag"); !strings.HasPrefix(etag, `"c3-`) {
		t.Fatalf("webp ETag = %q, want c3- scheme", etag)
	}

	req3 := httptest.NewRequest(http.MethodGet, "/api/cover/album", nil)
	rec3 := httptest.NewRecorder()
	CoverHandler(rec3, req3)
	if ct := rec3.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("no-Accept Content-Type = %q, want legacy image/jpeg", ct)
	}
	if etag := rec3.Header().Get("ETag"); !strings.HasPrefix(etag, `"c2-`) {
		t.Fatalf("legacy ETag = %q, want c2- scheme", etag)
	}
}

// The Data Saver worker builds a -128 copy for transcodable tracks and
// rebuilds it when the source changes; fresh copies are left alone.
func TestSyncDataSaverAssets(t *testing.T) {
	ff := findFF()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	setupTranscodeTestDB(t)
	src := setupRealFLAC(t)

	SyncDataSaverAssets()

	cachePath := filepath.Join(filepath.Dir(store.DBPath), "transcode", "track-128.m4a")
	info, err := os.Stat(cachePath)
	if err != nil {
		t.Fatalf("128k copy missing after sync: %v", err)
	}

	// Fresh copy: a second pass must not rebuild it.
	SyncDataSaverAssets()
	info2, err2 := os.Stat(cachePath)
	if err2 != nil || !info2.ModTime().Equal(info.ModTime()) {
		t.Fatal("second sync must reuse the fresh 128k copy")
	}

	// Edited source (mtime bump): the next pass rebuilds the copy.
	future := time.Now().Add(2 * time.Minute)
	os.Chtimes(src, future, future)
	SyncDataSaverAssets()
	info3, err3 := os.Stat(cachePath)
	if err3 != nil || !info3.ModTime().After(info.ModTime()) {
		t.Fatal("stale 128k copy must be rebuilt after the source changes")
	}
}

// The status endpoint reports readiness and live percent. b sanitization
// matches stream/warm: garbage b rides the server default bitrate key.
func TestTranscodeStatusHandler(t *testing.T) {
	setupTranscodeTestDB(t)
	src := setupRealFLAC(t)

	track := &models.Track{ID: "track", FilePath: "track.flac", Duration: 2}
	store.ReplaceLibrary(map[string]*models.Track{"track": track}, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/transcode-status/track?b=128", nil)
	TranscodeStatusHandler(rr, req)
	var body struct {
		Ready   bool    `json:"ready"`
		Percent float64 `json:"percent"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%q)", err, rr.Body.String())
	}
	if body.Ready {
		t.Fatal("expected ready=false before any encode")
	}

	// Force an encode to completion, then expect ready=true.
	if _, err := transcode.EnsureAt("track", src, "128"); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/api/transcode-status/track?b=128", nil)
	TranscodeStatusHandler(rr, req)
	body = struct {
		Ready   bool    `json:"ready"`
		Percent float64 `json:"percent"`
	}{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%q)", err, rr.Body.String())
	}
	if !body.Ready {
		t.Fatalf("expected ready=true, got %v (%q)", body, rr.Body.String())
	}

	// Garbage b → server default key; still a clean 200.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/api/transcode-status/track?b=banana", nil)
	TranscodeStatusHandler(rr, req)
	if rr.Code != 200 {
		t.Fatalf("garbage b: got %d", rr.Code)
	}

	// Unknown track → 404.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/api/transcode-status/nope", nil)
	TranscodeStatusHandler(rr, req)
	if rr.Code != 404 {
		t.Fatalf("unknown track: got %d, want 404", rr.Code)
	}
}
