package models_test

import (
	"musicapp/internal/models"
	"strings"
	"testing"
)

func TestGenerateID_deterministic(t *testing.T) {
	input := "Artist Name/Album Title/01 - Track Name.mp3"
	id1 := models.GenerateID(input)
	id2 := models.GenerateID(input)
	if id1 != id2 {
		t.Errorf("models.GenerateID not deterministic: %s != %s", id1, id2)
	}
}

func TestGenerateID_length(t *testing.T) {
	id := models.GenerateID("any input")
	if len(id) != 12 {
		t.Errorf("models.GenerateID returned %d chars, want 12: %q", len(id), id)
	}
}

func TestGenerateID_differentInputs(t *testing.T) {
	id1 := models.GenerateID("file1.mp3")
	id2 := models.GenerateID("file2.mp3")
	if id1 == id2 {
		t.Errorf("different inputs produced same ID: %s", id1)
	}
}

func TestGenerateID_hexOnly(t *testing.T) {
	id := models.GenerateID("test input")
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("models.GenerateID returned non-hex char: %c in %q", c, id)
		}
	}
}

func TestGenerateID_knownValue(t *testing.T) {
	id := models.GenerateID("test")
	want := "9f86d081884c"
	if id != want {
		t.Errorf("models.GenerateID(%q) = %q, want %q", "test", id, want)
	}
}

func TestGenerateAlbumID(t *testing.T) {
	id1 := models.GenerateAlbumID("Artist", "Album")
	id2 := models.GenerateAlbumID("artist", "album")
	if id1 != id2 {
		t.Errorf("models.GenerateAlbumID not case-insensitive: %q != %q", id1, id2)
	}
}

func TestGenerateAlbumID_separator(t *testing.T) {
	id := models.GenerateAlbumID("Artist", "Album")
	expected := models.GenerateID(strings.ToLower("Artist|Album"))
	if id != expected {
		t.Errorf("models.GenerateAlbumID = %q, want %q", id, expected)
	}
}

func TestGenerateUUID_format(t *testing.T) {
	id := models.GenerateUUID()
	parts := strings.Split(id, "-")
	if len(parts) != 5 {
		t.Errorf("UUID format wrong: %q", id)
	}
	if len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		t.Errorf("UUID segment lengths wrong: %q", id)
	}
}

func TestGenerateUUID_unique(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := models.GenerateUUID()
		if ids[id] {
			t.Errorf("duplicate UUID: %s", id)
		}
		ids[id] = true
	}
}

func TestCanonicalGenre(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"canonical", "Rock", "Rock"},
		{"alias", "alt. rock", "Alternative Rock"},
		{"subgenre preserved", "shoegaze", "Shoegaze"},
		{"ampersand spacing", "R & B", "R&B"},
		{"hyphen", "hip-hop", "Hip-Hop"},
		{"multiple values", "Rock, Pop", "Rock"},
		{"id3 numeric", "17", "Rock"},
		{"tech house", "Tech House", "Tech House"},
		{"melodic house", "melodic house", "Melodic House"},
		{"progressive trance", "Progressive Trance", "Progressive Trance"},
		{"dubstep", "dubstep", "Dubstep"},
		{"garage", "garage", "Garage"},
		{"uk house", "uk house", "UK House"},
		{"liquid drum and bass", "liquid drum and bass", "Liquid Drum & Bass"},
		{"other genre", "gamelan fusion", "Gamelan Fusion"},
		{"empty", "", ""},
		{"year junk", "2023", ""},
		{"mood junk", "Upbeat", ""},
		{"url junk", "https://example.com/rock", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := models.CanonicalGenre(tt.raw); got != tt.want {
				t.Fatalf("CanonicalGenre(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestCanonicalGenres(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{"single", "Rock", []string{"Rock"}},
		{"two", "Rock, Pop", []string{"Rock", "Pop"}},
		{"three mixed", "Rock; Pop/electronic", []string{"Rock", "Pop", "Electronic"}},
		{"dedup", "Rock, rock, ROCK", []string{"Rock"}},
		{"empty", "", nil},
		{"junk only", "Upbeat, Fast", nil},
		{"url", "https://example.com/rock", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := models.CanonicalGenres(tt.raw)
			if len(got) != len(tt.want) {
				t.Fatalf("CanonicalGenres(%q) = %v, want %v", tt.raw, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("CanonicalGenres(%q)[%d] = %q, want %q", tt.raw, i, got[i], tt.want[i])
				}
			}
		})
	}
}
