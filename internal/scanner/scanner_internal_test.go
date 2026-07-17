package scanner

import (
	"musicapp/internal/models"
	"testing"
)

func TestApplyScannedGenreMulti(t *testing.T) {
	track := &models.Track{ID: "t1", Genre: "Rock, Pop"}
	applyScannedGenre(track, nil)
	if track.GenreCanonical != "Rock, Pop" {
		t.Fatalf("applyScannedGenre multi = %q, want Rock, Pop", track.GenreCanonical)
	}
	if track.GenreSource != "tag" {
		t.Fatalf("applyScannedGenre source = %q, want tag", track.GenreSource)
	}
}

func TestApplyScannedGenreDeduplicates(t *testing.T) {
	track := &models.Track{ID: "t2", Genre: "rock, ROCK, Rock"}
	applyScannedGenre(track, nil)
	if track.GenreCanonical != "Rock" {
		t.Fatalf("applyScannedGenre dedup = %q, want Rock", track.GenreCanonical)
	}
}
