package downloads

import (
	"encoding/json"
	"testing"
)

func intPtr(v int) *int { return &v }

// TestSlskNormalize verifies the comparison key produced by slskNormalize:
// lowercasing, punctuation/space collapsing, and trimming. The implementation
// replaces every non-[a-z0-9] rune with a space and joins the remaining
// alphanumeric runs with single spaces — it does NOT strip parenthetical
// content, it keeps it as text.
func TestSlskNormalize(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"already clean", "Artist Title", "artist title"},
		{"upper to lower", "ARTIST Title", "artist title"},
		{"all caps", "ARTIST", "artist"},
		{"dash separator", "Artist - Title", "artist title"},
		{"underscore separator", "Artist_Title", "artist title"},
		{"multiple spaces", "Artist   Title", "artist title"},
		{"leading/trailing whitespace", "  Artist Title  ", "artist title"},
		{"parentheses become spaces (content kept)", "Title (Official Video)", "title official video"},
		{"brackets become spaces (content kept)", "Title [Remastered]", "title remastered"},
		{"mixed punctuation", "Artist: Title!", "artist title"},
		{"numbers preserved", "Track 99", "track 99"},
		{"only punctuation", " - _ ( ) ", ""},
		{"empty string", "", ""},
		{"unicode replaced with space", "Café Crème", "caf cr me"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := slskNormalize(tt.in)
			if got != tt.want {
				t.Errorf("slskNormalize(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// TestSlskStrongMatch verifies that strong matching is case- and
// punctuation-insensitive (it compares slskNormalize output via substring
// containment of artist and title within the filename).
func TestSlskStrongMatch(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		artist   string
		title    string
		want     bool
	}{
		{
			name:     "exact artist dash title flac",
			filename: "Pink Floyd - Money.flac",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     true,
		},
		{
			name:     "case differences still match",
			filename: "PINK FLOYD - MONEY.flac",
			artist:   "pink floyd",
			title:    "money",
			want:     true,
		},
		{
			name:     "punctuation differences still match",
			filename: "Pink_Floyd_-_Money.flac",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     true,
		},
		{
			name:     "unrelated filename does not match",
			filename: "Nirvana - Smells Like Teen Spirit.mp3",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     false,
		},
		{
			name:     "title present but artist missing",
			filename: "Money.flac",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     false,
		},
		{
			name:     "artist present but title missing",
			filename: "Pink Floyd - Time.flac",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     false,
		},
		{
			name:     "extra suffix in filename still matches via containment",
			filename: "Pink Floyd - Money (Remastered).flac",
			artist:   "Pink Floyd",
			title:    "Money",
			want:     true,
		},
		{
			name:     "empty artist and title matches anything",
			filename: "anything.flac",
			artist:   "",
			title:    "",
			want:     true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cand := slskRawCandidate{Filename: tt.filename}
			got := slskStrongMatch(cand, tt.artist, tt.title)
			if got != tt.want {
				t.Errorf("slskStrongMatch(filename=%q, artist=%q, title=%q) = %v, want %v",
					tt.filename, tt.artist, tt.title, got, tt.want)
			}
		})
	}
}

// TestAutoPickSlsk verifies candidate auto-selection: strong matches only,
// FLAC preferred over MP3, returns the candidate's Index field (not slice
// position), and (-1, false) when nothing matches.
func TestAutoPickSlsk(t *testing.T) {
	flac := slskRawCandidate{Index: 0, Format: "flac", Filename: "Artist - Title.flac", Size: 30_000_000}
	mp3 := slskRawCandidate{Index: 1, Format: "mp3", Filename: "Artist - Title.mp3", Size: 5_000_000, Bitrate: intPtr(320)}
	unrelated := slskRawCandidate{Index: 2, Format: "flac", Filename: "Someone Else - Other.flac", Size: 30_000_000}
	m4a := slskRawCandidate{Index: 3, Format: "m4a", Filename: "Artist - Title.m4a", Size: 5_000_000}
	flacNoFormat := slskRawCandidate{Index: 4, Format: "", Filename: "Artist - Title.flac", Size: 30_000_000}
	mp3NoFormat := slskRawCandidate{Index: 5, Format: "", Filename: "Artist - Title.mp3", Size: 5_000_000, Bitrate: intPtr(320)}

	tests := []struct {
		name      string
		cands     []slskRawCandidate
		wantIdx   int
		wantFound bool
	}{
		{
			name:      "flac preferred over mp3 when both strong match",
			cands:     []slskRawCandidate{mp3, flac},
			wantIdx:   0,
			wantFound: true,
		},
		{
			name:      "flac preferred even when mp3 comes first in slice",
			cands:     []slskRawCandidate{mp3, flac},
			wantIdx:   0,
			wantFound: true,
		},
		{
			name:      "only mp3 strong match returns mp3 index",
			cands:     []slskRawCandidate{mp3},
			wantIdx:   1,
			wantFound: true,
		},
		{
			name:      "no strong match returns not found",
			cands:     []slskRawCandidate{unrelated},
			wantIdx:   -1,
			wantFound: false,
		},
		{
			name:      "empty candidate list returns not found",
			cands:     []slskRawCandidate{},
			wantIdx:   -1,
			wantFound: false,
		},
		{
			name:      "non-strong candidates ignored",
			cands:     []slskRawCandidate{unrelated, m4a},
			wantIdx:   3,
			wantFound: true,
		},
		{
			name:      "strong match of unsupported format accepted via relaxation",
			cands:     []slskRawCandidate{m4a},
			wantIdx:   3,
			wantFound: true,
		},
		{
			name:      "flac inferred from filename when Format empty",
			cands:     []slskRawCandidate{flacNoFormat},
			wantIdx:   4,
			wantFound: true,
		},
		{
			name:      "mp3 inferred from filename when Format empty",
			cands:     []slskRawCandidate{mp3NoFormat},
			wantIdx:   5,
			wantFound: true,
		},
		{
			name:      "mixed strong and weak: only strong counted",
			cands:     []slskRawCandidate{unrelated, mp3, flac},
			wantIdx:   0,
			wantFound: true,
		},
	}

	const artist = "Artist"
	const title = "Title"
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotIdx, gotFound := autoPickSlsk(tt.cands, artist, title, title, 0)
			if gotIdx != tt.wantIdx || gotFound != tt.wantFound {
				t.Errorf("autoPickSlsk(...) = (%d, %v), want (%d, %v)",
					gotIdx, gotFound, tt.wantIdx, tt.wantFound)
			}
		})
	}
}

// TestAutoPickSlsk_returnsCandidateIndexNotSlicePosition is a focused regression
// test: autoPickSlsk must return the candidate's Index field value, not the
// position within the input slice.
func TestAutoPickSlsk_returnsCandidateIndexNotSlicePosition(t *testing.T) {
	cands := []slskRawCandidate{
		{Index: 10, Format: "mp3", Filename: "Artist - Title.mp3", Size: 5_000_000, Bitrate: intPtr(320)},
	}
	idx, found := autoPickSlsk(cands, "Artist", "Title", "Title", 0)
	if !found {
		t.Fatalf("expected found=true, got false")
	}
	if idx != 10 {
		t.Errorf("expected returned index 10 (candidate Index field), got %d", idx)
	}
}

// slskPickerEntry mirrors the JSON shape the YouTube picker modal consumes and
// that slskCandidatesToJSON must produce.
type slskPickerEntry struct {
	VideoID  string `json:"videoId"`
	Title    string `json:"title"`
	Channel  string `json:"channel"`
	Duration int    `json:"duration"`
	Score    int    `json:"score"`
}

// TestSlskCandidatesToJSON verifies the mapping from raw candidates to the
// picker UI JSON shape, including nil Duration coercion to 0 and the score
// constant of 50.
func TestSlskCandidatesToJSON(t *testing.T) {
	br := 320
	dur := 210
	path := "/home/user/Music/Artist - Title.flac"

	cands := []slskRawCandidate{
		{
			Index:    7,
			Username: "sharer1",
			Filename: path,
			Size:     12345,
			Bitrate:  &br,
			Duration: &dur,
			Format:   "flac",
		},
		{
			// nil Bitrate/Duration — UI mapping coerces these to 0.
			Index:    8,
			Username: "sharer2",
			Filename: "Artist - Title.mp3",
			Size:     5000,
			Bitrate:  nil,
			Duration: nil,
			Format:   "mp3",
		},
	}

	out, err := slskCandidatesToJSON(cands)
	if err != nil {
		t.Fatalf("slskCandidatesToJSON returned error: %v", err)
	}

	var got []slskPickerEntry
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("failed to unmarshal output: %v\noutput: %s", err, out)
	}

	if len(got) != len(cands) {
		t.Fatalf("expected %d entries, got %d (out=%s)", len(cands), len(got), out)
	}

	// Entry 0: full metadata.
	if got[0].VideoID != "7" {
		t.Errorf("got[0].VideoID = %q, want %q", got[0].VideoID, "7")
	}
	if wantTitle := "Artist - Title.flac"; got[0].Title != wantTitle {
		t.Errorf("got[0].Title = %q, want %q (filepath.Base of %q)", got[0].Title, wantTitle, path)
	}
	if got[0].Channel != "sharer1" {
		t.Errorf("got[0].Channel = %q, want %q", got[0].Channel, "sharer1")
	}
	if got[0].Duration != 210 {
		t.Errorf("got[0].Duration = %d, want 210", got[0].Duration)
	}
	if got[0].Score != 50 {
		t.Errorf("got[0].Score = %d, want 50", got[0].Score)
	}

	// Entry 1: nil duration coerced to 0.
	if got[1].VideoID != "8" {
		t.Errorf("got[1].VideoID = %q, want %q", got[1].VideoID, "8")
	}
	if got[1].Title != "Artist - Title.mp3" {
		t.Errorf("got[1].Title = %q, want %q", got[1].Title, "Artist - Title.mp3")
	}
	if got[1].Channel != "sharer2" {
		t.Errorf("got[1].Channel = %q, want %q", got[1].Channel, "sharer2")
	}
	if got[1].Duration != 0 {
		t.Errorf("got[1].Duration = %d, want 0 (nil coerced)", got[1].Duration)
	}
	if got[1].Score != 50 {
		t.Errorf("got[1].Score = %d, want 50", got[1].Score)
	}
}

// TestSlskCandidatesToJSON_empty verifies the empty-slice case yields a JSON
// array (not null) so the frontend always receives [].
func TestSlskCandidatesToJSON_empty(t *testing.T) {
	out, err := slskCandidatesToJSON(nil)
	if err != nil {
		t.Fatalf("slskCandidatesToJSON(nil) returned error: %v", err)
	}
	if out != "[]" {
		t.Errorf("slskCandidatesToJSON(nil) = %q, want %q", out, "[]")
	}

	out2, err := slskCandidatesToJSON([]slskRawCandidate{})
	if err != nil {
		t.Fatalf("slskCandidatesToJSON([]) returned error: %v", err)
	}
	if out2 != "[]" {
		t.Errorf("slskCandidatesToJSON([]) = %q, want %q", out2, "[]")
	}
}
