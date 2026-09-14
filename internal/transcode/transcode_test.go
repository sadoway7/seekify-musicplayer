package transcode

import (
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func setupTranscodeTest(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
	store.InitDB(filepath.Join(tmp, "test.db"))
	return tmp
}

// fakeFfmpeg puts a stub ffmpeg on PATH. `exec` in the body matters: it
// replaces the shell process so a context kill terminates the sleeper
// itself — a forked child would survive the kill holding the output pipe
// open and CombinedOutput would block until the child exits anyway.
func fakeFmpegStub(t *testing.T, body string) {
	t.Helper()
	bin := t.TempDir()
	script := filepath.Join(bin, "ffmpeg")
	if err := os.WriteFile(script, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestEnsureTimesOutWedgedFfmpeg(t *testing.T) {
	setupTranscodeTest(t)
	fakeFmpegStub(t, "exec sleep 60")
	src := filepath.Join(t.TempDir(), "a.flac")
	os.WriteFile(src, []byte("x"), 0o644)

	old := ensureTimeout
	ensureTimeout = 200 * time.Millisecond
	defer func() { ensureTimeout = old }()

	start := time.Now()
	_, err := Ensure("wedged", src)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("wedged ffmpeg: expected error, got success")
	}
	if elapsed > 5*time.Second {
		t.Fatalf("timeout did not fire: took %s", elapsed)
	}
}

// A timed-out encode must release its semaphore slot: after a wedge, a
// healthy encode must still complete.
func TestEnsureReleasesSemAfterTimeout(t *testing.T) {
	setupTranscodeTest(t)
	src := filepath.Join(t.TempDir(), "a.flac")
	os.WriteFile(src, []byte("x"), 0o644)

	bin := t.TempDir()
	script := filepath.Join(bin, "ffmpeg")
	writeStub := func(body string) {
		os.WriteFile(script, []byte("#!/bin/sh\n"+body), 0o755)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	old := ensureTimeout
	ensureTimeout = 2 * time.Second
	defer func() { ensureTimeout = old }()

	writeStub("exec sleep 60")
	if _, err := Ensure("s1", src); err == nil {
		t.Fatal("expected wedge error")
	}

	// Swap to a healthy stub; if the wedge leaked the sem, this hangs and
	// the test times out.
	writeStub(`for last; do :; done; echo ok > "$last"`)
	done := make(chan error, 1)
	go func() {
		_, err := Ensure("s2", src)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("post-wedge ensure failed: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("semaphore leaked: healthy ensure blocked after a timed-out wedge")
	}
}

func TestEnsureSucceedsAndCaches(t *testing.T) {
	setupTranscodeTest(t)
	// The output tmp path is the LAST argument.
	fakeFmpegStub(t, `for last; do :; done; echo fakeaudio > "$last"`)
	src := filepath.Join(t.TempDir(), "b.flac")
	os.WriteFile(src, []byte("x"), 0o644)

	p, err := Ensure("ok", src)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}
}

func TestPruneCacheSpareFreshTmp(t *testing.T) {
	setupTranscodeTest(t)
	dir := cacheDir()
	os.MkdirAll(dir, 0o755)
	now := time.Now()

	freshTmp := filepath.Join(dir, "fresh.m4a.tmp")
	oldTmp := filepath.Join(dir, "old.m4a.tmp")
	oldM4a := filepath.Join(dir, "ancient.m4a")
	for _, f := range []string{freshTmp, oldTmp, oldM4a} {
		os.WriteFile(f, []byte("data"), 0o644)
	}
	os.Chtimes(oldTmp, now.Add(-2*time.Hour), now.Add(-2*time.Hour))
	os.Chtimes(oldM4a, now.Add(-31*24*time.Hour), now.Add(-31*24*time.Hour))

	PruneCache()

	if _, err := os.Stat(freshTmp); err != nil {
		t.Error("fresh .tmp (in-flight encode) was deleted by prune")
	}
	if _, err := os.Stat(oldTmp); err == nil {
		t.Error("stale .tmp survived prune")
	}
	if _, err := os.Stat(oldM4a); err == nil {
		t.Error("31-day-old .m4a survived age purge")
	}
}

// mp4Box builds one MP4 box: 4-byte big-endian size + fourcc + payload.
func mp4Box(typ string, payload ...[]byte) []byte {
	var p []byte
	for _, part := range payload {
		p = append(p, part...)
	}
	b := make([]byte, 8+len(p))
	binary.BigEndian.PutUint32(b[0:4], uint32(len(b)))
	copy(b[4:8], typ)
	copy(b[8:], p)
	return b
}

// m4aFile writes the given boxes to a temp .m4a and returns its path.
func m4aFile(t *testing.T, boxes ...[]byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "a.m4a")
	var b []byte
	for _, box := range boxes {
		b = append(b, box...)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestIsBrowserUnsupportedM4A(t *testing.T) {
	stsd := func(codec string) []byte {
		return mp4Box("stsd", []byte{0, 0, 0, 0, 0, 0, 0, 1}, mp4Box(codec, []byte{0xC0, 0xFF, 0xEE}))
	}
	audioTrak := func(s []byte) []byte {
		return mp4Box("moov", mp4Box("trak", mp4Box("mdia", mp4Box("minf", mp4Box("stbl", s)))))
	}

	if p := m4aFile(t, mp4Box("ftyp", []byte("M4A ")), audioTrak(stsd("alac"))); !IsBrowserUnsupportedM4A(p) {
		t.Error("alac stsd not detected")
	}
	if p := m4aFile(t, mp4Box("ftyp", []byte("M4A ")), audioTrak(stsd("ec-3"))); !IsBrowserUnsupportedM4A(p) {
		t.Error("ec-3 (Dolby/Spatial Audio) stsd not detected")
	}
	if p := m4aFile(t, mp4Box("ftyp", []byte("M4A ")), audioTrak(stsd("ac-3"))); !IsBrowserUnsupportedM4A(p) {
		t.Error("ac-3 (Dolby Digital) stsd not detected")
	}
	if p := m4aFile(t, mp4Box("ftyp", []byte("M4A ")), audioTrak(stsd("mp4a"))); IsBrowserUnsupportedM4A(p) {
		t.Error("mp4a (AAC) misdetected as ALAC")
	}
	if p := m4aFile(t, []byte("this is not an mp4 at all")); IsBrowserUnsupportedM4A(p) {
		t.Error("garbage detected as ALAC")
	}
	if p := m4aFile(t, mp4Box("ftyp", []byte("M4A ")), mp4Box("mdat", make([]byte, 64))); IsBrowserUnsupportedM4A(p) {
		t.Error("file without stsd detected as ALAC")
	}
}

// TestIsALACRealFiles validates the box walker against real ffmpeg-muxed
// files (full moov tree: mvhd, tkhd, edts, real stsd payloads). Skipped
// when ffmpeg is absent (graceful degradation — synthetic tests still run).
func TestIsBrowserUnsupportedM4ARealFiles(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	gen := func(name, codec string) string {
		p := filepath.Join(dir, name)
		cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
			"-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
			"-c:a", codec, p)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("generate %s: %v: %s", name, err, out)
		}
		return p
	}
	if p := gen("alac.m4a", "alac"); !IsBrowserUnsupportedM4A(p) {
		t.Error("real ALAC file not detected")
	}
	if p := gen("aac.m4a", "aac"); IsBrowserUnsupportedM4A(p) {
		t.Error("real AAC file misdetected as ALAC")
	}
}

// Regression: a real Apple Music "Spatial Audio" rip (E-AC-3 in m4a) pulled
// from a production library. Chrome cannot decode Dolby codecs and reports
// MP4 support via canPlayType, so the server must force transcoding for it.
func TestIsBrowserUnsupportedM4AProdSpatialAudioFile(t *testing.T) {
	path := os.Getenv("SEEKIFY_SPATIAL_M4A")
	if path == "" {
		t.Skip("SEEKIFY_SPATIAL_M4A not set")
	}
	if !IsBrowserUnsupportedM4A(path) {
		t.Fatal("real Spatial Audio (ec-3) file not detected")
	}
}

func TestCachePathAtNaming(t *testing.T) {
	// The legacy unsuffixed name must stay bound to 192k so every existing
	// deployment's warm cache remains valid.
	if got, want := CachePath("abc"), CachePathAt("abc", "192"); got != want {
		t.Fatalf("CachePath(abc) = %q, want CachePathAt(abc,192) = %q", got, want)
	}
	if got := CachePathAt("abc", "192"); !strings.HasSuffix(got, "abc.m4a") {
		t.Fatalf("CachePathAt(abc,192) = %q, want suffix abc.m4a (legacy name)", got)
	}
	if got := CachePathAt("abc", "128"); !strings.HasSuffix(got, "abc-128.m4a") {
		t.Fatalf("CachePathAt(abc,128) = %q, want suffix abc-128.m4a", got)
	}
}

func TestParseOutTime(t *testing.T) {
	if s, ok := parseOutTime("00:00:02.000000"); !ok || s != 2 {
		t.Fatalf("parseOutTime seconds: got %v %v", s, ok)
	}
	if s, ok := parseOutTime("01:02:03.5"); !ok || s != 3723.5 {
		t.Fatalf("parseOutTime h:m:s: got %v %v", s, ok)
	}
	if _, ok := parseOutTime("N/A"); ok {
		t.Fatal("N/A should not parse")
	}
	if _, ok := parseOutTime("garbage"); ok {
		t.Fatal("garbage should not parse")
	}
}

// While an encode runs, Progress must expose the out_time/duration percent
// (clamped 0-99); when ensure returns, the key must be gone (-1) and the
// cache file fresh. The stub ffmpeg emits one progress line mid-run.
func TestEnsureReportsProgress(t *testing.T) {
	setupTranscodeTest(t)
	fakeFmpegStub(t, `for last; do :; done
echo "out_time=00:00:02.000000"
sleep 0.4
echo "progress=end"
echo fakeaudio > "$last"`)
	src := filepath.Join(t.TempDir(), "p.flac")
	os.WriteFile(src, []byte("x"), 0o644)

	var prev map[string]*models.Track
	store.View(func(l *store.Library) { prev = l.Tracks })
	store.ReplaceLibrary(map[string]*models.Track{
		"prog": {ID: "prog", FilePath: "p.flac", Duration: 4},
	}, nil)
	t.Cleanup(func() { store.ReplaceLibrary(prev, nil) })

	done := make(chan error, 1)
	go func() { _, err := EnsureAt("prog", src, "128"); done <- err }()

	deadline := time.After(5 * time.Second)
	for {
		p := Progress("prog", "128")
		if p == 50 {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("ensure finished before progress was observed (last %v): %v", p, err)
		case <-deadline:
			t.Fatalf("progress never reached 50%%, last %v", p)
		default:
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := <-done; err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if p := Progress("prog", "128"); p != -1 {
		t.Fatalf("progress key survived completion: got %v, want -1", p)
	}
	if !IsReadyAt("prog", src, "128") {
		t.Fatal("cache file missing after ensure")
	}
}

// No duration on file → -1 (unknown), never a bogus percent.
func TestProgressUnknownWithoutDuration(t *testing.T) {
	setupTranscodeTest(t)
	fakeFmpegStub(t, `for last; do :; done
echo "out_time=00:00:01.000000"
echo fakeaudio > "$last"`)
	src := filepath.Join(t.TempDir(), "p.flac")
	os.WriteFile(src, []byte("x"), 0o644)
	if _, err := EnsureAt("nodur", src, "128"); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	// Key is deleted on completion; while it existed it would have been -1
	// (duration 0). Either way the post-condition is -1.
	if p := Progress("nodur", "128"); p != -1 {
		t.Fatalf("progress after completion: got %v, want -1", p)
	}
}

// Foreground encodes must not queue behind background work: with both
// transSem slots held by slow background encodes, a foreground encode still
// completes in its own encode time (it owns the reserved fgSem lane).
func TestForegroundEncodeDoesntQueueBehindBackground(t *testing.T) {
	setupTranscodeTest(t)
	fakeFmpegStub(t, `sleep 3
for last; do :; done
echo fakeaudio > "$last"`)
	src := filepath.Join(t.TempDir(), "a.flac")
	os.WriteFile(src, []byte("x"), 0o644)

	for _, id := range []string{"bg1", "bg2"} {
		go EnsureLow(id, src)
	}
	time.Sleep(150 * time.Millisecond) // let both background encodes take the pool

	fgDone := make(chan error, 1)
	start := time.Now()
	go func() { _, err := Ensure("fg", src); fgDone <- err }()
	select {
	case err := <-fgDone:
		if err != nil {
			t.Fatalf("foreground ensure: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("foreground encode queued behind background work")
	}
	if elapsed := time.Since(start); elapsed > 4500*time.Millisecond {
		t.Fatalf("foreground encode took %s — it waited behind the background pool", elapsed)
	}
}
