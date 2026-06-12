package main

import (
	"strings"
	"testing"
)

func TestGenerateID_deterministic(t *testing.T) {
	input := "Artist Name/Album Title/01 - Track Name.mp3"
	id1 := generateID(input)
	id2 := generateID(input)
	if id1 != id2 {
		t.Errorf("generateID not deterministic: %s != %s", id1, id2)
	}
}

func TestGenerateID_length(t *testing.T) {
	id := generateID("any input")
	if len(id) != 12 {
		t.Errorf("generateID returned %d chars, want 12: %q", len(id), id)
	}
}

func TestGenerateID_differentInputs(t *testing.T) {
	id1 := generateID("file1.mp3")
	id2 := generateID("file2.mp3")
	if id1 == id2 {
		t.Errorf("different inputs produced same ID: %s", id1)
	}
}

func TestGenerateID_hexOnly(t *testing.T) {
	id := generateID("test input")
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("generateID returned non-hex char: %c in %q", c, id)
		}
	}
}

func TestGenerateID_knownValue(t *testing.T) {
	id := generateID("test")
	want := "9f86d081884c"
	if id != want {
		t.Errorf("generateID(%q) = %q, want %q", "test", id, want)
	}
}

func TestGenerateAlbumID(t *testing.T) {
	id1 := generateAlbumID("Artist", "Album")
	id2 := generateAlbumID("artist", "album")
	if id1 != id2 {
		t.Errorf("generateAlbumID not case-insensitive: %q != %q", id1, id2)
	}
}

func TestGenerateAlbumID_separator(t *testing.T) {
	id := generateAlbumID("Artist", "Album")
	expected := generateID(strings.ToLower("Artist|Album"))
	if id != expected {
		t.Errorf("generateAlbumID = %q, want %q", id, expected)
	}
}

func TestGenerateUUID_format(t *testing.T) {
	id := generateUUID()
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
		id := generateUUID()
		if ids[id] {
			t.Errorf("duplicate UUID: %s", id)
		}
		ids[id] = true
	}
}
