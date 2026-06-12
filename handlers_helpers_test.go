package main

import "testing"

func TestCleanRescanTitle(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Song Title", "Song Title"},
		{"Song Title (Official Music Video)", "Song Title"},
		{"Song Title [Official Audio]", "Song Title"},
		{"Song Title (Official)", "Song Title"},
		{"Song Title [HD]", "Song Title"},
		{"Song Title (OFFICIAL)", "Song Title"},
		{"Song Title (Official HD Video)", "Song Title"},
		{"  Song Title  ", "Song Title"},
		{"Song Title [OFFICIAL]", "Song Title"},
		{"Song Title (Lyric Video)", "Song Title"},
		{"Song Title (Official 4K Music Video)", "Song Title"},
		{"Song Title (Visualiser)", "Song Title"},
		{"Something [Remastered 2023]", "Something"},
	}
	for _, tt := range tests {
		got := cleanRescanTitle(tt.input)
		if got != tt.want {
			t.Errorf("cleanRescanTitle(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestCleanRescanArtist(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Artist Name", "Artist Name"},
		{"Artist Name - Topic", "Artist Name"},
		{"ArtistVEVO", "Artist"},
		{"Artist Official", "Artist"},
		{"ArtistOfficialMusic", "Artist"},
		{"ArtistTV", "Artist"},
		{"  Artist  ", "Artist"},
	}
	for _, tt := range tests {
		got := cleanRescanArtist(tt.input)
		if got != tt.want {
			t.Errorf("cleanRescanArtist(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParseVideoTitle_dash(t *testing.T) {
	artist, title := parseVideoTitle("Artist - Song Title", "Channel")
	if artist != "Artist" {
		t.Errorf("artist = %q, want %q", artist, "Artist")
	}
	if title != "Song Title" {
		t.Errorf("title = %q, want %q", title, "Song Title")
	}
}

func TestParseVideoTitle_noDash(t *testing.T) {
	artist, title := parseVideoTitle("Song Title", "Channel")
	if artist != "Channel" {
		t.Errorf("artist = %q, want %q", artist, "Channel")
	}
	if title != "Song Title" {
		t.Errorf("title = %q, want %q", title, "Song Title")
	}
}

func TestParseVideoTitle_withSuffix(t *testing.T) {
	artist, title := parseVideoTitle("Artist - Song Title (Official Music Video)", "Channel")
	if artist != "Artist" {
		t.Errorf("artist = %q, want %q", artist, "Artist")
	}
	if title != "Song Title" {
		t.Errorf("title = %q, want %q", title, "Song Title")
	}
}

func TestScoreMatchV2_exact(t *testing.T) {
	score := scoreMatchV2("test title", "test artist", "test artist", "test title")
	if score <= 0 {
		t.Errorf("expected positive score for exact match, got %f", score)
	}
}

func TestScoreMatchV2_noMatch(t *testing.T) {
	score := scoreMatchV2("something", "someone", "other", "different")
	if score != 0 {
		t.Errorf("expected 0 for no match, got %f", score)
	}
}

func TestScoreMatchV2_partial(t *testing.T) {
	score := scoreMatchV2("test title song", "test artist", "test artist", "test title")
	if score <= 0 {
		t.Errorf("expected positive score for partial match, got %f", score)
	}
}
