package review

import (
	"musicapp/internal/models"
	"musicapp/internal/store"
	"path/filepath"
	"testing"
)

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
		got := NormalizeForCompare(tt.input)
		if got != tt.want {
			t.Errorf("NormalizeForCompare(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestTitleSimilarity_exact(t *testing.T) {
	score := TitleSimilarity("Hello World", "Hello World")
	if score != 1.0 {
		t.Errorf("exact match = %f, want 1.0", score)
	}
}

func TestTitleSimilarity_partial(t *testing.T) {
	score := TitleSimilarity("Hello World", "Hello There")
	if score <= 0 || score >= 1.0 {
		t.Errorf("partial match = %f, want between 0 and 1", score)
	}
}

func TestTitleSimilarity_noMatch(t *testing.T) {
	score := TitleSimilarity("Completely Different", "No Overlap Words")
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
		got := IsGenericName(tt.input, nil)
		if got != tt.want {
			t.Errorf("IsGenericName(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestIsGenericName_extras(t *testing.T) {
	if !IsGenericName("custom", []string{"custom"}) {
		t.Error("should match extra generic name")
	}
	if IsGenericName("custom", nil) {
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
		track := &models.Track{Title: tt.title, FilePath: tt.filePath}
		got := IsFilenameDerived(track)
		if got != tt.want {
			t.Errorf("IsFilenameDerived(%q, %q) = %v, want %v", tt.filePath, tt.title, got, tt.want)
		}
	}
}

func TestQualityScore(t *testing.T) {
	full := &models.Track{Title: "Title", Artist: "Artist", Album: "Album", HasCover: true, TrackNumber: 1, Year: 2020, Genre: "Rock", Duration: 200}
	empty := &models.Track{Title: "", Artist: "", Album: "", HasCover: false}
	fullScore := QualityScore(full)
	emptyScore := QualityScore(empty)
	if fullScore <= emptyScore {
		t.Errorf("full track (%d) should score higher than empty (%d)", fullScore, emptyScore)
	}
}

func TestPickBestQuality(t *testing.T) {
	tracks := []*models.Track{
		{Title: "A", HasCover: false, FilePath: "a.mp3"},
		{Title: "B", HasCover: true, FilePath: "b.mp3"},
	}
	best := PickBestQuality(tracks)
	if !best.HasCover {
		t.Error("should pick track with cover")
	}
}

func TestBoolToInt(t *testing.T) {
	if store.BoolToInt(true) != 1 {
		t.Error("store.BoolToInt(true) should be 1")
	}
	if store.BoolToInt(false) != 0 {
		t.Error("store.BoolToInt(false) should be 0")
	}
}

func TestTrackHasEffectiveCover(t *testing.T) {
	trackNoCover := &models.Track{HasCover: false, AlbumID: "nosuchalbum"}
	if trackHasEffectiveCover(trackNoCover) {
		t.Error("track with no cover and no album should be false")
	}

	trackEmbedded := &models.Track{HasCover: true, AlbumID: "album1"}
	if !trackHasEffectiveCover(trackEmbedded) {
		t.Error("track with embedded cover should be true")
	}

	store.Mu.Lock()
	if store.Albums == nil {
		store.Albums = make(map[string]*models.Album)
	}
	store.Albums["album-mb"] = &models.Album{ID: "album-mb", HasCover: true}
	store.Mu.Unlock()
	trackAlbumCover := &models.Track{HasCover: false, AlbumID: "album-mb"}
	if !trackHasEffectiveCover(trackAlbumCover) {
		t.Error("track whose album has cover should be true")
	}
	store.Mu.Lock()
	delete(store.Albums, "album-mb")
	store.Mu.Unlock()
}

func TestSaveGenreResultPersistsSourceAndTimestamp(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "genre.db"))
	track := &models.Track{ID: "genre-result", Title: "Song", FilePath: "Song.mp3"}
	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{track.ID: track}
	store.Mu.Unlock()
	store.DbUpsertTrack(track)

	if !saveGenreResult(track.ID, "Rock", "musicbrainz", 123) {
		t.Fatal("saveGenreResult returned false for a valid track")
	}
	loaded := store.DbGetTrackByID(track.ID)
	if loaded.GenreCanonical != "Rock" || loaded.GenreSource != "musicbrainz" || loaded.GenreCheckedAt != 123 {
		t.Fatalf("saved result = %#v, want Rock/musicbrainz/123", loaded)
	}

	empty := &models.Track{ID: "genre-empty", Title: "Empty", FilePath: "Empty.mp3"}
	store.Mu.Lock()
	store.Tracks[empty.ID] = empty
	store.Mu.Unlock()
	store.DbUpsertTrack(empty)
	if !saveGenreResult(empty.ID, "", "none", 456) {
		t.Fatal("saveGenreResult returned false for a valid empty result")
	}
	loaded = store.DbGetTrackByID(empty.ID)
	if loaded.GenreCanonical != "" || loaded.GenreSource != "none" || loaded.GenreCheckedAt != 456 {
		t.Fatalf("saved empty result = %#v, want empty/none/456", loaded)
	}
}

func TestCheckMetadataCompletenessUsesCanonicalGenre(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "review.db"))
	track := &models.Track{
		Title: "Song", Artist: "Artist", Album: "Album", HasCover: true,
		Genre: "Upbeat", GenreCanonical: "Tech House",
	}
	for _, flag := range CheckMetadataCompleteness(track) {
		if flag == "missing_genre" {
			t.Fatal("canonical genre was incorrectly flagged as missing")
		}
	}
	track.GenreCanonical = ""
	flags := CheckMetadataCompleteness(track)
	found := false
	for _, flag := range flags {
		if flag == "missing_genre" {
			found = true
		}
	}
	if !found {
		t.Fatal("empty canonical genre was not flagged")
	}
}

func TestDbUpdateTrackMetaAcceptsMultipleGenres(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "multi-genre.db"))
	track := &models.Track{ID: "multi", Title: "Song", Artist: "Artist", FilePath: "Song.mp3", HasCover: true}
	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{track.ID: track}
	store.Mu.Unlock()
	store.DbUpsertTrack(track)

	DbUpdateTrackMeta(track.ID, map[string]interface{}{
		"title": track.Title, "artist": track.Artist, "album": "Album",
		"albumArtist": track.Artist, "genreCanonical": "Rock, Pop, Electronic",
	})
	loaded := store.DbGetTrackByID(track.ID)
	if loaded.GenreCanonical != "Rock, Pop, Electronic" {
		t.Fatalf("DbUpdateTrackMeta genre = %q, want Rock, Pop, Electronic", loaded.GenreCanonical)
	}
	if loaded.GenreSource != "manual" {
		t.Fatalf("DbUpdateTrackMeta genre source = %q, want manual", loaded.GenreSource)
	}
}

func TestSaveGenreResultLeavesMemoryOnDatabaseError(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "genre-error.db"))
	track := &models.Track{ID: "genre-error", Title: "Song", FilePath: "Song.mp3"}
	store.Mu.Lock()
	store.Tracks = map[string]*models.Track{track.ID: track}
	store.Mu.Unlock()
	store.DbUpsertTrack(track)
	store.DB.Close()
	t.Cleanup(func() { store.InitDB(filepath.Join(t.TempDir(), "genre-error-restore.db")) })

	if saveGenreResult(track.ID, "Rock", "musicbrainz", 123) {
		t.Fatal("saveGenreResult succeeded with a closed database")
	}
	if track.GenreCanonical != "" || track.GenreCheckedAt != 0 {
		t.Fatalf("memory changed after failed save: %#v", track)
	}
}
