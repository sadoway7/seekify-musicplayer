package musicbrainz

import "testing"

func TestRecordingReleasePriorityPrefersOriginalAlbum(t *testing.T) {
	original := recordingReleasePriority("Album", nil, "Discovery", "Daft Punk", "Official")
	compilation := recordingReleasePriority("Album", []string{"Compilation"}, "Electronic Collection", "Various Artists", "Official")
	if original <= compilation {
		t.Fatalf("original album priority = %d, compilation priority = %d", original, compilation)
	}
}

func TestEffectiveReleaseTypeUsesSecondaryClassification(t *testing.T) {
	if got := EffectiveReleaseType("Album", []string{"Compilation"}); got != "Compilation" {
		t.Fatalf("effective type = %q, want Compilation", got)
	}
	if got := EffectiveReleaseType("Album", nil); got != "Album" {
		t.Fatalf("effective type = %q, want Album", got)
	}
}

func TestEarlierReleaseDate(t *testing.T) {
	if !earlierReleaseDate("1997-01-01", "2007-01-01") {
		t.Fatal("earlier dated release was not preferred")
	}
	if earlierReleaseDate("", "2007-01-01") {
		t.Fatal("undated release should not replace a dated release")
	}
}
