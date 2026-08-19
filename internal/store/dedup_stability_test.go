package store

import (
	"path/filepath"
	"testing"

	"musicapp/internal/models"
)

// TestDedupCrossPrefixPrefersPrimary pins the pass-2 survivor policy: when the
// same relative path exists both in the primary library and as a media: twin,
// the PRIMARY copy wins — matching the scanner's cross-prefix policy. The old
// ORDER BY (has_metadata DESC first) kept the better-tagged media: row,
// deleted the primary row, and the scanner re-added it every cycle, forcing a
// full library reload under Mu.Lock each dedup run. The second run here must
// find nothing to do.
func TestDedupCrossPrefixPrefersPrimary(t *testing.T) {
	InitDB(filepath.Join(t.TempDir(), "test.db"))

	primary := &models.Track{ID: models.GenerateID("Artist/Album/song.mp3"), FilePath: "Artist/Album/song.mp3"}
	media := &models.Track{ID: models.GenerateID("media:Artist/Album/song.mp3"), FilePath: "media:Artist/Album/song.mp3", HasMetadata: true}
	if err := DbUpsertTrack(primary); err != nil {
		t.Fatal(err)
	}
	if err := DbUpsertTrack(media); err != nil {
		t.Fatal(err)
	}

	if !dedupTracksByFilePath() {
		t.Fatal("first dedup run should remove the media: twin")
	}
	if n := countT(t, `SELECT COUNT(*) FROM tracks WHERE file_path=?`, primary.FilePath); n != 1 {
		t.Fatalf("primary twin should survive, got %d rows", n)
	}
	if n := countT(t, `SELECT COUNT(*) FROM tracks WHERE file_path=?`, media.FilePath); n != 0 {
		t.Fatalf("media: twin should be removed, got %d rows", n)
	}

	// Stable state: a second run must be a no-op (returns false → no reload).
	if dedupTracksByFilePath() {
		t.Fatal("second dedup run should find nothing — primary/scan policy aligned")
	}
}
