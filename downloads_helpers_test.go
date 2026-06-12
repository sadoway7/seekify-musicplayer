package main

import "testing"

func TestScoreSearchResult_channelMatch(t *testing.T) {
	score := scoreSearchResult("Artist - Title", "Artist Official", "Artist", "Title", 0)
	if score <= 0 {
		t.Errorf("channel match should be positive, got %f", score)
	}
}

func TestScoreSearchResult_titleMatch(t *testing.T) {
	score := scoreSearchResult("Title", "Channel", "Artist", "Title", 0)
	if score <= 0 {
		t.Errorf("title match should be positive, got %f", score)
	}
}

func TestScoreSearchResult_karaokePenalty(t *testing.T) {
	normal := scoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	karaoke := scoreSearchResult("Artist - Title Karaoke", "Artist", "Artist", "Title", 0)
	if karaoke >= normal {
		t.Errorf("karaoke should score lower: normal=%f karaoke=%f", normal, karaoke)
	}
}

func TestScoreSearchResult_remixPenalty(t *testing.T) {
	normal := scoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	remix := scoreSearchResult("Artist - Title Remix", "Artist", "Artist", "Title", 0)
	if remix >= normal {
		t.Errorf("remix should score lower: normal=%f remix=%f", normal, remix)
	}
}

func TestScoreSearchResult_livePenalty(t *testing.T) {
	normal := scoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	live := scoreSearchResult("Artist - Title Live", "Artist", "Artist", "Title", 0)
	if live >= normal {
		t.Errorf("live should score lower: normal=%f live=%f", normal, live)
	}
}

func TestScoreSearchResult_officialBoost(t *testing.T) {
	plain := scoreSearchResult("Artist - Title", "Artist", "Artist", "Title", 0)
	official := scoreSearchResult("Artist - Title Official Audio", "Artist", "Artist", "Title", 0)
	if official <= plain {
		t.Errorf("official should score higher: plain=%f official=%f", plain, official)
	}
}

func TestLevenshteinContains_exact(t *testing.T) {
	if !levenshteinContains("hello world", "hello") {
		t.Error("exact substring should match")
	}
}

func TestLevenshteinContains_empty(t *testing.T) {
	if levenshteinContains("hello", "") {
		t.Error("empty substring should not match")
	}
}

func TestLevenshteinContains_wordMatch(t *testing.T) {
	if !levenshteinContains("the quick brown fox", "quick brown") {
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
		got := sanitizeFilename(tt.input)
		if got != tt.want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", tt.input, got, tt.want)
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
		got := extractBitrateFromQuality(tt.input)
		if got != tt.want {
			t.Errorf("extractBitrateFromQuality(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}
