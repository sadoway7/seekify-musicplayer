package main

import "testing"

func TestScoreMatch_exact(t *testing.T) {
	score := scoreMatch("Artist", "Title", "Artist", "Title", "")
	if score != 1.0 {
		t.Errorf("exact match = %f, want 1.0", score)
	}
}

func TestScoreMatch_partialTitle(t *testing.T) {
	score := scoreMatch("Artist", "Short", "Artist", "A Short Title", "")
	if score <= 0 {
		t.Errorf("partial title match should be > 0, got %f", score)
	}
}

func TestScoreMatch_compilationPenalty(t *testing.T) {
	normalScore := scoreMatch("Artist", "Title", "Artist", "Title", "")
	compScore := scoreMatch("Artist", "Title", "Artist", "Title", "Greatest Hits")
	if compScore >= normalScore {
		t.Errorf("compilation should score lower: normal=%f comp=%f", normalScore, compScore)
	}
}

func TestScoreMatch_noMatch(t *testing.T) {
	score := scoreMatch("X", "Y", "A", "B", "")
	if score != 0.0 {
		t.Errorf("no match = %f, want 0.0", score)
	}
}

func TestEscapeLucene(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{`simple`, `simple`},
		{`a"b`, `a\"b`},
		{`a+b`, `a\+b`},
		{`a-b`, `a\-b`},
		{`a(b)`, `a\(b\)`},
		{`a:b`, `a\:b`},
		{`a/b`, `a\/b`},
	}
	for _, tt := range tests {
		got := escapeLucene(tt.input)
		if got != tt.want {
			t.Errorf("escapeLucene(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestIsCompilationTitle(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"Greatest Hits", true},
		{"Best of Artist", true},
		{"Now That's What I Call Music", true},
		{"Regular Album", false},
		{"the compilation", true},
		{"A Collection", true},
	}
	for _, tt := range tests {
		got := isCompilationTitle(tt.input)
		if got != tt.want {
			t.Errorf("isCompilationTitle(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
