package review

import (
	"database/sql"
	"musicapp/internal/models"
	"musicapp/internal/store"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
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

// Every review-status write must invalidate the library version — the
// /api/library ETag depends on it. The bump lives inside DbSetReviewStatus
// (the choke point) so no caller can forget it.
func TestDbSetReviewStatusBumpsLibraryVersion(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "bump.db"))
	InitReviewTables()

	before := store.LibraryVersion.Load()

	DbSetReviewStatus("t1", "needs_review", `["missing_title"]`, "test")
	if after := store.LibraryVersion.Load(); after != before+1 {
		t.Fatalf("DbSetReviewStatus bumps = %d, want 1", after-before)
	}
}

// Boot-path panic class: CleanupOrphanedReviews runs synchronously at startup
// (server.go, no recover). A write-lock contention (WAL lets the read pass,
// the DELETE stalls then errors) must not crash the process with a nil
// Result deref — at boot that is process death, not a recovered 500.
func TestCleanupOrphanedReviewsSurvivesWriteLock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "locked.db")
	store.InitDB(dbPath)
	InitReviewTables()

	// One in-memory track, already reviewed → the INSERT loop no-ops and the
	// only stalled write is the orphan DELETE.
	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	store.ReplaceLibrary(map[string]*models.Track{"t1": {ID: "t1", Title: "S", FilePath: "s.mp3"}}, nil)
	DbSetReviewStatus("t1", "reviewed_ok", "[]", "test")
	t.Cleanup(func() { store.ReplaceLibrary(prevTracks, nil) })

	conn, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Exec("BEGIN IMMEDIATE"); err != nil {
		t.Fatalf("hold write lock: %v", err)
	}
	defer conn.Exec("ROLLBACK")

	CleanupOrphanedReviews() // must not panic
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
		tagged   bool
		want     bool
	}{
		{"Artist/Album/Track Name.mp3", "Track Name", false, true},
		{"Artist/Album/Real Title.mp3", "Different Title", false, false},
		{"Artist/Album/Song Title.flac", "Song Title", false, true},
		{"media:Artist/Album/Song.mp3", "Song", false, true},
		// Tagged tracks whose title matches their filename must NOT be flagged
		// — the title came from a real tag, not a filename guess (yt-dlp/Soulseek).
		{"Artist/Album/lovely.flac", "lovely", true, false},
		{"Artist/Album/Song.mp3", "Song", true, false},
	}
	for _, tt := range tests {
		track := &models.Track{Title: tt.title, FilePath: tt.filePath, HasMetadata: tt.tagged}
		got := IsFilenameDerived(track)
		if got != tt.want {
			t.Errorf("IsFilenameDerived(%q, %q, tagged=%v) = %v, want %v", tt.filePath, tt.title, tt.tagged, got, tt.want)
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

	store.ReplaceLibrary(nil, map[string]*models.Album{"album-mb": {ID: "album-mb", HasCover: true}})
	trackAlbumCover := &models.Track{HasCover: false, AlbumID: "album-mb"}
	if !trackHasEffectiveCover(trackAlbumCover) {
		t.Error("track whose album has cover should be true")
	}
	store.Update(func(l *store.Library) { delete(l.Albums, "album-mb") })
}

func TestSaveGenreResultPersistsSourceAndTimestamp(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "genre.db"))
	track := &models.Track{ID: "genre-result", Title: "Song", FilePath: "Song.mp3"}
	store.ReplaceLibrary(map[string]*models.Track{track.ID: track}, nil)
	store.DbUpsertTrack(track)

	if !saveGenreResult(track.ID, "Rock", "musicbrainz", 123) {
		t.Fatal("saveGenreResult returned false for a valid track")
	}
	loaded := store.DbGetTrackByID(track.ID)
	if loaded.GenreCanonical != "Rock" || loaded.GenreSource != "musicbrainz" || loaded.GenreCheckedAt != 123 {
		t.Fatalf("saved result = %#v, want Rock/musicbrainz/123", loaded)
	}

	empty := &models.Track{ID: "genre-empty", Title: "Empty", FilePath: "Empty.mp3"}
	store.Update(func(l *store.Library) { l.Tracks[empty.ID] = empty })
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
	// The genre flag ships off by default; enable it to exercise the logic.
	store.SetSetting("review_flag_missing_genre", "true")
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
	store.ReplaceLibrary(map[string]*models.Track{track.ID: track}, nil)
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

func TestDbGetReviewFlagCounts(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "review.db"))
	InitReviewTables()

	var prevTracks map[string]*models.Track
	store.View(func(l *store.Library) { prevTracks = l.Tracks })
	store.ReplaceLibrary(map[string]*models.Track{
		"a": {ID: "a", Title: "A", FilePath: "a.mp3"},
		"b": {ID: "b", Title: "B", FilePath: "b.mp3"},
	}, nil)
	t.Cleanup(func() { store.ReplaceLibrary(prevTracks, nil) })

	DbSetReviewStatus("a", "needs_review", `["missing_title","no_cover"]`, "worker")
	DbSetReviewStatus("b", "needs_review", `["missing_title"]`, "worker")
	DbSetReviewStatus("ghost", "needs_review", `["missing_title"]`, "worker") // track not in memory — must not count
	DbSetReviewStatus("c", "reviewed_ok", `["missing_title"]`, "worker")     // must not count

	counts := DbGetReviewFlagCounts()
	if counts["missing_title"] != 2 {
		t.Errorf("missing_title = %d, want 2", counts["missing_title"])
	}
	if counts["no_cover"] != 1 {
		t.Errorf("no_cover = %d, want 1", counts["no_cover"])
	}
	if counts["suspicious_video"] != 0 {
		t.Errorf("unflagged flag = %d, want 0", counts["suspicious_video"])
	}
}

func TestDbGetStaleReviewTracks(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "review.db"))
	InitReviewTables()
	store.ReplaceLibrary(map[string]*models.Track{
		"fresh": {ID: "fresh", Title: "Fresh", FilePath: "Fresh.mp3"},
		"stale": {ID: "stale", Title: "Stale", FilePath: "Stale.mp3"},
	}, nil)
	t.Cleanup(func() { store.Update(func(l *store.Library) { l.Tracks = nil }) })

	DbSetReviewStatus("fresh", "needs_review", "[]", "worker")
	DbSetReviewStatus("stale", "needs_review", "[]", "worker")
	store.DB.Exec(`UPDATE track_reviews SET checked_at = datetime('now','-2 hours') WHERE track_id = 'stale'`)

	stale := DbGetStaleReviewTracks("needs_review", 1*time.Hour, 50)
	for _, id := range stale {
		if id == "fresh" {
			t.Error("track checked now must not be stale for age=1h (format mismatch regression)")
		}
	}
	found := false
	for _, id := range stale {
		if id == "stale" {
			found = true
		}
	}
	if !found {
		t.Error("track checked 2h ago must be stale for age=1h")
	}
}

func TestSaveGenreResultLeavesMemoryOnDatabaseError(t *testing.T) {
	store.InitDB(filepath.Join(t.TempDir(), "genre-error.db"))
	track := &models.Track{ID: "genre-error", Title: "Song", FilePath: "Song.mp3"}
	store.ReplaceLibrary(map[string]*models.Track{track.ID: track}, nil)
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
