package transcode

import (
	"os"
	"path/filepath"
	"testing"
	"time"

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
