package scanner_test

import (
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"testing"
)

func TestTitleFromFilename(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"music/Artist/Album/Track Name.mp3", "Track Name"},
		{"music/Track.flac", "Track"},
		{"music/01 - Song.m4a", "01 - Song"},
		{"music/Artist Name.ogg", "Artist Name"},
	}
	for _, tt := range tests {
		got := scanner.TitleFromFilename(tt.input)
		if got != tt.want {
			t.Errorf("TitleFromFilename(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestGeneratePlaceholderSVG(t *testing.T) {
	svg := scanner.GeneratePlaceholderSVG("Test", "abc123")
	if !contains(svg, "<svg") {
		t.Error("placeholder missing <svg tag")
	}
	if !contains(svg, "T") {
		t.Error("placeholder missing initial letter T")
	}
}

func TestGeneratePlaceholderSVG_emptyName(t *testing.T) {
	svg := scanner.GeneratePlaceholderSVG("", "abc123")
	if !contains(svg, "?") {
		t.Error("empty name should show ?")
	}
}

func TestGeneratePlaceholderSVG_deterministicColor(t *testing.T) {
	svg1 := scanner.GeneratePlaceholderSVG("Test", "id1")
	svg2 := scanner.GeneratePlaceholderSVG("Test", "id1")
	if svg1 != svg2 {
		t.Error("same inputs should produce same SVG")
	}
}

func TestGeneratePlaceholderSVG_differentIDs(t *testing.T) {
	svg1 := scanner.GeneratePlaceholderSVG("Test", "id1")
	svg2 := scanner.GeneratePlaceholderSVG("Test", "id2")
	if svg1 == svg2 {
		t.Error("different IDs should produce different SVGs")
	}
}

func TestResolveFilePath_primary(t *testing.T) {
	store.MusicDir = "/music"
	store.MusicDirs = map[string]string{"": "/music"}
	got := scanner.ResolveFilePath("Artist/Album/track.mp3")
	want := "/music/Artist/Album/track.mp3"
	if got != want {
		t.Errorf("ResolveFilePath(%q) = %q, want %q", "Artist/Album/track.mp3", got, want)
	}
}

func TestResolveFilePath_mediaPrefix(t *testing.T) {
	store.MusicDir = "/music"
	store.MusicDirs = map[string]string{"": "/music", "media": "/media"}
	got := scanner.ResolveFilePath("media:Artist/Album/track.mp3")
	want := "/media/Artist/Album/track.mp3"
	if got != want {
		t.Errorf("ResolveFilePath(%q) = %q, want %q", "media:Artist/Album/track.mp3", got, want)
	}
}

func TestResolveFilePath_noPrefix(t *testing.T) {
	store.MusicDir = "/music"
	store.MusicDirs = map[string]string{"": "/music"}
	got := scanner.ResolveFilePath("track.mp3")
	want := "/music/track.mp3"
	if got != want {
		t.Errorf("ResolveFilePath(%q) = %q, want %q", "track.mp3", got, want)
	}
}

func TestMusicDirForPath_primary(t *testing.T) {
	store.MusicDir = "/music"
	store.MusicDirs = map[string]string{"": "/music", "media": "/media"}
	got := scanner.MusicDirForPath("track.mp3")
	if got != "/music" {
		t.Errorf("MusicDirForPath(%q) = %q, want /music", "track.mp3", got)
	}
}

func TestMusicDirForPath_media(t *testing.T) {
	store.MusicDir = "/music"
	store.MusicDirs = map[string]string{"": "/music", "media": "/media"}
	got := scanner.MusicDirForPath("media:track.mp3")
	if got != "/media" {
		t.Errorf("MusicDirForPath(%q) = %q, want /media", "media:track.mp3", got)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(len(s) > 0 && len(sub) > 0 && findSubstring(s, sub)))
}

func findSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
