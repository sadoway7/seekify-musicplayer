package main

import "testing"

func TestNormalizeForCompare(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Hello World", "hello world"},
		{"Hello-World", "hello world"},
		{"Hello_World", "hello world"},
		{"Hello (World)", "hello world"},
		{"Hello [World]", "hello world"},
		{"Hello.World", "helloworld"},
		{"  Hello   World  ", "hello world"},
	}
	for _, tt := range tests {
		got := normalizeForCompare(tt.input)
		if got != tt.want {
			t.Errorf("normalizeForCompare(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestTitleSimilarity_exact(t *testing.T) {
	score := titleSimilarity("Hello World", "Hello World")
	if score != 1.0 {
		t.Errorf("exact match = %f, want 1.0", score)
	}
}

func TestTitleSimilarity_partial(t *testing.T) {
	score := titleSimilarity("Hello World", "Hello There")
	if score <= 0 || score >= 1.0 {
		t.Errorf("partial match = %f, want between 0 and 1", score)
	}
}

func TestTitleSimilarity_noMatch(t *testing.T) {
	score := titleSimilarity("Completely Different", "No Overlap Words")
	if score != 0.0 {
		t.Errorf("no match = %f, want 0.0", score)
	}
}

func TestIsGenericName(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"", true},
		{"Track", true},
		{"Unknown", true},
		{"Untitled", true},
		{"track 5", true},
		{"Track 05", true},
		{"Real Title", false},
		{"My Song", false},
	}
	for _, tt := range tests {
		got := isGenericName(tt.input, nil)
		if got != tt.want {
			t.Errorf("isGenericName(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestIsGenericName_extras(t *testing.T) {
	if !isGenericName("custom", []string{"custom"}) {
		t.Error("should match extra generic name")
	}
	if isGenericName("custom", nil) {
		t.Error("should not match when extras is nil")
	}
}

func TestIsFilenameDerived(t *testing.T) {
	tests := []struct {
		filePath string
		title    string
		want     bool
	}{
		{"Artist/Album/Track Name.mp3", "Track Name", true},
		{"Artist/Album/Real Title.mp3", "Different Title", false},
		{"Artist/Album/Song Title.flac", "Song Title", true},
		{"media:Artist/Album/Song.mp3", "Song", true},
	}
	for _, tt := range tests {
		track := &Track{Title: tt.title, FilePath: tt.filePath}
		got := isFilenameDerived(track)
		if got != tt.want {
			t.Errorf("isFilenameDerived(%q, %q) = %v, want %v", tt.filePath, tt.title, got, tt.want)
		}
	}
}

func TestQualityScore(t *testing.T) {
	full := &Track{Title: "Title", Artist: "Artist", Album: "Album", HasCover: true, TrackNumber: 1, Year: 2020, Genre: "Rock", Duration: 200}
	empty := &Track{Title: "", Artist: "", Album: "", HasCover: false}
	fullScore := qualityScore(full)
	emptyScore := qualityScore(empty)
	if fullScore <= emptyScore {
		t.Errorf("full track (%d) should score higher than empty (%d)", fullScore, emptyScore)
	}
}

func TestPickBestQuality(t *testing.T) {
	tracks := []*Track{
		{Title: "A", HasCover: false, FilePath: "a.mp3"},
		{Title: "B", HasCover: true, FilePath: "b.mp3"},
	}
	best := pickBestQuality(tracks)
	if !best.HasCover {
		t.Error("should pick track with cover")
	}
}

func TestBoolToInt(t *testing.T) {
	if boolToInt(true) != 1 {
		t.Error("boolToInt(true) should be 1")
	}
	if boolToInt(false) != 0 {
		t.Error("boolToInt(false) should be 0")
	}
}
