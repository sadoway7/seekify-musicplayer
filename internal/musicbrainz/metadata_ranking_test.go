package musicbrainz

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
)

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

func TestReserveMusicBrainzSlotSerializes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "musicbrainz-rate")
	start := make(chan struct{})
	reserved := make(chan time.Time, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			when, err := reserveMusicBrainzSlot(path, 5*time.Millisecond)
			if err != nil {
				t.Errorf("reserveMusicBrainzSlot: %v", err)
				return
			}
			reserved <- when
		}()
	}
	close(start)
	wg.Wait()
	close(reserved)

	var times []time.Time
	for when := range reserved {
		times = append(times, when)
	}
	if len(times) != 2 {
		t.Fatalf("got %d reservations, want 2", len(times))
	}
	delta := times[0].Sub(times[1])
	if delta < 0 {
		delta = -delta
	}
	if delta < 5*time.Millisecond {
		t.Fatalf("reservations were %s apart, want at least 5ms", delta)
	}
}

func TestParseRecordingGenresSortsByCount(t *testing.T) {
	body := []byte(`{"genres":[{"name":"Rock","count":2},{"name":"Tech House","count":7}]}`)
	got, err := parseRecordingGenres(body)
	if err != nil {
		t.Fatalf("parseRecordingGenres: %v", err)
	}
	if len(got) != 2 || got[0] != "Tech House" || got[1] != "Rock" {
		t.Fatalf("genres = %#v, want count-descending order", got)
	}
}
