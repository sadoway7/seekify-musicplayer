package downloads

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScoreSearchResult_channelMatch(t *testing.T) {
	score := ScoreSearchResult("Artist - Title", "Artist Official", "Artist", "Title", 0)
	if score <= 0 {
		t.Errorf("channel match should be positive, got %f", score)
	}
}

func TestScoreSearchResult_titleMatch(t *testing.T) {
	score := ScoreSearchResult("Title", "Channel", "Artist", "Title", 0)
	if score <= 0 {
		t.Errorf("title match should be positive, got %f", score)
	}
}

func TestScoreSearchResult_karaokePenalty(t *testing.T) {
	normal := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	karaoke := ScoreSearchResult("Artist - Title Karaoke", "Artist", "Artist", "Title", 0)
	if karaoke >= normal {
		t.Errorf("karaoke should score lower: normal=%f karaoke=%f", normal, karaoke)
	}
}

func TestScoreSearchResult_remixPenalty(t *testing.T) {
	normal := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	remix := ScoreSearchResult("Artist - Title Remix", "Artist", "Artist", "Title", 0)
	if remix >= normal {
		t.Errorf("remix should score lower: normal=%f remix=%f", normal, remix)
	}
}

func TestScoreSearchResult_livePenalty(t *testing.T) {
	normal := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	live := ScoreSearchResult("Artist - Title Live", "Artist", "Artist", "Title", 0)
	if live >= normal {
		t.Errorf("live should score lower: normal=%f live=%f", normal, live)
	}
}

func TestScoreSearchResult_officialBoost(t *testing.T) {
	plain := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	official := ScoreSearchResult("Artist - Title Official Audio", "Artist", "Artist", "Title", 0)
	if official <= plain {
		t.Errorf("official should score higher: plain=%f official=%f", plain, official)
	}
}

func TestLevenshteinContains_exact(t *testing.T) {
	if !LevenshteinContains("hello world", "hello") {
		t.Error("exact substring should match")
	}
}

func TestLevenshteinContains_empty(t *testing.T) {
	if LevenshteinContains("hello", "") {
		t.Error("empty substring should not match")
	}
}

func TestLevenshteinContains_wordMatch(t *testing.T) {
	if !LevenshteinContains("the quick brown fox", "quick brown") {
		t.Error("words should fuzzy match")
	}
}

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"normal name", "normal name"},
		{"a/b", "a_b"},
		{"a\\b", "a_b"},
		{"a:b", "a_b"},
		{"a*b", "a_b"},
		{"  name  ", "name"},
		{"name.", "name"},
	}
	for _, tt := range tests {
		got := SanitizeFilename(tt.input)
		if got != tt.want {
			t.Errorf("SanitizeFilename(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestExtractBitrateFromQuality(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"MP3 320kbps", 320},
		{"FLAC 44.1kHz", 0},
		{"AAC 128kbps", 128},
		{"FLAC", 0},
	}
	for _, tt := range tests {
		got := ExtractBitrateFromQuality(tt.input)
		if got != tt.want {
			t.Errorf("ExtractBitrateFromQuality(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

func TestScoreSearchResult_prefersAudioOverVideoVersion(t *testing.T) {
	audio := ScoreSearchResult("Artist - Title (Official Audio)", "Artist - Topic", "Artist", "Title", 200)
	video := ScoreSearchResult("Artist - Title (Official Music Video)", "Artist", "Artist", "Title", 240)
	if audio <= video {
		t.Fatalf("audio version must outrank video version: audio=%.0f video=%.0f", audio, video)
	}
}

func TestScoreSearchResult_videoPenalty(t *testing.T) {
	normal := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 200)
	video := ScoreSearchResult("Artist - Title (Official Music Video)", "Artist", "Artist", "Title", 200)
	if video >= normal {
		t.Fatalf("video version must score below plain title: video=%.0f normal=%.0f", video, normal)
	}
	// Even a Vevo channel (music-video uploader) must not outrank the plain upload.
	vevoVideo := ScoreSearchResult("Artist - Title (Official Video)", "ArtistVEVO", "Artist", "Title", 200)
	if vevoVideo >= normal {
		t.Fatalf("vevo video must score below plain title: vevo=%.0f normal=%.0f", vevoVideo, normal)
	}
}

func TestScoreSearchResult_videoTitleWantedNotPenalized(t *testing.T) {
	// User explicitly asked for a video (title contains "video") — no penalty.
	video := ScoreSearchResult("Artist - Title Video", "Artist", "Artist", "Title Video", 200)
	plain := ScoreSearchResult("Artist - Title", "Artist", "Artist", "Title Video", 200)
	if video < plain {
		t.Fatalf("expected-title containing 'video' must not be penalized: %.0f vs %.0f", video, plain)
	}
}

// TestCleanupFailedDownload_onlyDeletesMatchingStem is a regression test:
// cleanupFailedDownload must only delete files whose stem matches THIS job's
// safeTitle. Bulk album rips share destDir across jobs — the old bare
// suffix matches (`.part`, `.tmp`, ...) deleted sibling jobs' partial and
// completed files.
func TestCleanupFailedDownload_onlyDeletesMatchingStem(t *testing.T) {
	dir := t.TempDir()
	stem := "artist - track"
	cases := map[string]bool{ // filename -> should be deleted
		"artist - track.part":             true,
		"artist - track.tmp":              true,
		"artist - track.incomplete":       true,
		"artist - track.mp3.ytdl":         true,
		"artist - track.flac":             true, // exact-stem audio (original intent)
		"othertrack.part":                 false,
		"othertrack.flac":                 false,
		"other artist - other.incomplete": false,
	}
	for name := range cases {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}

	cleanupFailedDownload(dir, stem)

	for name, wantGone := range cases {
		_, err := os.Stat(filepath.Join(dir, name))
		gone := os.IsNotExist(err)
		if gone != wantGone {
			t.Errorf("%q: deleted=%v, want deleted=%v", name, gone, wantGone)
		}
	}
}

func TestScoreSearchResult_liveTopicUploadBeatenByStudio(t *testing.T) {
	// Real case: the auto-generated Topic upload of the LIVE album stacked
	// channel+topic+music bonuses and outranked every studio upload; the
	// downloaded "studio" track was actually a concert recording.
	liveTopic := ScoreSearchResult("Cry (Live Version (Album Version))", "The Philosopher Kings - Topic", "The Philosopher Kings", "Cry", 264)
	vevoVideo := ScoreSearchResult("The Philosopher Kings - Cry (Official Video)", "PhilosopherKingsVEVO", "The Philosopher Kings", "Cry", 199)
	plain := ScoreSearchResult("Philosopher Kings - Cry", "Tauxedo", "The Philosopher Kings", "Cry", 184)
	if liveTopic >= vevoVideo || liveTopic >= plain {
		t.Fatalf("live Topic upload must not outrank studio uploads: live=%.0f vevo=%.0f plain=%.0f", liveTopic, vevoVideo, plain)
	}
}

func TestScoreSearchResult_livePenaltyWordBoundary(t *testing.T) {
	live := ScoreSearchResult("I Am The Man (Live Version (Album Version))", "The Philosopher Kings - Topic", "The Philosopher Kings", "I Am the Man", 336)
	studio := ScoreSearchResult("I Am The Man", "The Philosopher Kings - Topic", "The Philosopher Kings", "I Am the Man", 336)
	if live >= studio {
		t.Fatalf("live marker must cost score vs identical studio upload: live=%.0f studio=%.0f", live, studio)
	}
	// Words merely containing "live" must NOT be penalized ("believer" has no
	// "live" token; "Deliverance"/"Olive" DO contain the substring and would
	// trip a naive guard — avoided here because the expected-title guard is
	// itself a substring check).
	ok := ScoreSearchResult("Believer", "Artist", "Artist", "Believer", 200)
	flagged := ScoreSearchResult("Believer (live)", "Artist", "Artist", "Believer", 200)
	if flagged >= ok {
		t.Fatalf("word-boundary live check failed: %.0f vs %.0f", flagged, ok)
	}
}

func TestScoreSearchResult_liveWantedNotPenalized(t *testing.T) {
	wanted := ScoreSearchResult("Cry (Live at Massey Hall)", "The Philosopher Kings - Topic", "The Philosopher Kings", "Cry (Live)", 264)
	if wanted < 0 {
		t.Fatalf("user asked for live — must not be penalized into the floor, got %.0f", wanted)
	}
}

func TestDurationMatchScore(t *testing.T) {
	// Real case: studio "I Am The Man" 264s, live Topic upload 336s (127%).
	if s := DurationMatchScore(336, 264); s >= 0 {
		t.Fatalf("live-length candidate must be penalized, got %.0f", s)
	}
	if s := DurationMatchScore(264, 264); s != 60 {
		t.Fatalf("exact match must score +60, got %.0f", s)
	}
	if s := DurationMatchScore(240, 264); s != 25 {
		t.Fatalf("close upload variance should score +25, got %.0f", s)
	}
	if s := DurationMatchScore(264, 0); s != 0 {
		t.Fatalf("unknown expected duration must be a no-op, got %.0f", s)
	}
	if s := DurationMatchScore(0, 264); s != 0 {
		t.Fatalf("unknown candidate duration must be a no-op, got %.0f", s)
	}
	if s := DurationMatchScore(60, 264); s >= 0 {
		t.Fatalf("clip-length candidate must be penalized, got %.0f", s)
	}
}

func TestScoreSearchResult_durationBeatsTopicBonusStack(t *testing.T) {
	// End-to-end: the exact case that shipped a live version as the studio
	// track. Live Topic upload stacks channel+title+topic bonuses but is
	// 336s vs the known 264s studio length; the plain Topic studio upload
	// at the right duration must win.
	live := ScoreSearchResult("I Am The Man (Live Version (Album Version))", "The Philosopher Kings - Topic", "The Philosopher Kings", "I Am the Man", 336) + DurationMatchScore(336, 264)
	studio := ScoreSearchResult("I Am The Man", "The Philosopher Kings - Topic", "The Philosopher Kings", "I Am the Man", 264) + DurationMatchScore(264, 264)
	if live >= studio {
		t.Fatalf("duration signal must beat the Topic bonus stack: live=%.0f studio=%.0f", live, studio)
	}
}
