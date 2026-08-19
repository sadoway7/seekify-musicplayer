package waveform

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func writeWaveCache(t *testing.T, trackID string, peaks []float64, mtime time.Time) {
	t.Helper()
	EnsureWaveformDir()
	data, _ := json.Marshal(map[string]interface{}{"peaks": peaks})
	p := WaveformPath(trackID)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	os.Chtimes(p, mtime, mtime)
}

func TestGetCachedWaveformStaleAfterSourceChange(t *testing.T) {
	tmp := t.TempDir()
	store.InitDB(filepath.Join(tmp, "test.db"))
	store.MusicDir = tmp
	src := filepath.Join(tmp, "song.flac")
	os.WriteFile(src, []byte("audio"), 0o644)

	now := time.Now()
	os.Chtimes(src, now, now)

	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{"stale1": {ID: "stale1", FilePath: "song.flac"}}
	store.Mu.Unlock()

	// Cache older than source → miss.
	writeWaveCache(t, "stale1", []float64{0.1, 0.5}, now.Add(-time.Hour))
	if peaks, _ := GetCachedWaveform("stale1"); peaks != nil {
		t.Fatal("cache predating source must be a miss")
	}

	// Cache newer than source → hit.
	writeWaveCache(t, "stale1", []float64{0.1, 0.5}, now.Add(time.Hour))
	peaks, _ := GetCachedWaveform("stale1")
	if peaks == nil || len(peaks) != 2 {
		t.Fatal("fresh cache must hit")
	}
}
