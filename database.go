package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"musicapp/internal/models"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	db     *sql.DB
	dbPath string
)

func initDB(path string) {
	dir := filepath.Dir(path)
	os.MkdirAll(dir, 0755)

	var err error
	db, err = sql.Open("sqlite", path)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	dbPath = path

	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA busy_timeout=5000")

	db.Exec(`CREATE TABLE IF NOT EXISTS favorites (
		track_id TEXT PRIMARY KEY,
		added_at INTEGER NOT NULL DEFAULT 0
	)`)

	db.Exec(`ALTER TABLE favorites ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)

	db.Exec(`CREATE TABLE IF NOT EXISTS recent (
		track_id TEXT PRIMARY KEY,
		position INTEGER NOT NULL
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS playlists (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS playlist_tracks (
		playlist_id TEXT NOT NULL,
		track_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (playlist_id, track_id)
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS metadata_matches (
		id TEXT PRIMARY KEY,
		track_id TEXT NOT NULL,
		track_title TEXT NOT NULL,
		track_artist TEXT NOT NULL,
		mb_title TEXT NOT NULL,
		mb_artist TEXT NOT NULL,
		mb_album TEXT NOT NULL,
		mb_album_id TEXT NOT NULL,
		mb_score REAL NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		UNIQUE(track_id, mb_album_id)
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS tracks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		artist TEXT NOT NULL DEFAULT '',
		album TEXT NOT NULL DEFAULT '',
		album_artist TEXT NOT NULL DEFAULT '',
		album_id TEXT NOT NULL DEFAULT '',
		track_number INTEGER NOT NULL DEFAULT 0,
		year INTEGER NOT NULL DEFAULT 0,
		genre TEXT NOT NULL DEFAULT '',
		duration INTEGER NOT NULL DEFAULT 0,
		file_path TEXT NOT NULL,
		has_cover INTEGER NOT NULL DEFAULT 0,
		mod_time INTEGER NOT NULL DEFAULT 0,
		has_metadata INTEGER NOT NULL DEFAULT 0
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS albums (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		artist TEXT NOT NULL DEFAULT '',
		track_count INTEGER NOT NULL DEFAULT 0,
		year INTEGER NOT NULL DEFAULT 0,
		has_cover INTEGER NOT NULL DEFAULT 0
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS downloads (
		track_id TEXT PRIMARY KEY,
		disabled INTEGER NOT NULL DEFAULT 0
	)`)
	db.Exec(`ALTER TABLE downloads ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`)

	db.Exec(`CREATE TABLE IF NOT EXISTS shared_queues (
		id TEXT PRIMARY KEY,
		track_ids TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`)

	// Add orig_* columns for undo support (SQLite ALTER TABLE ADD COLUMN is safe)
	db.Exec(`ALTER TABLE tracks ADD COLUMN orig_title TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE tracks ADD COLUMN orig_artist TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE tracks ADD COLUMN orig_album TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE tracks ADD COLUMN orig_album_artist TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE tracks ADD COLUMN orig_album_id TEXT NOT NULL DEFAULT ''`)

	// Add added_at to favorites for ordering (newest first)
	db.Exec(`ALTER TABLE favorites ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)

	initDownloadTables()
	initSettingsTable()
	initWatchedTables()
	initReviewTables()

	migrateFromJSON()
}

func migrateFromJSON() {
	jsonPath := filepath.Join(filepath.Dir(dbPath), "state.json")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return
	}

	var old models.AppState
	if err := json.Unmarshal(data, &old); err != nil {
		return
	}

	if len(old.Favorites) > 0 || len(old.Recent) > 0 || len(old.Playlists) > 0 {
		log.Printf("Migrating state.json to SQLite...")
	}

	for _, id := range old.Favorites {
		db.Exec("INSERT OR IGNORE INTO favorites (track_id) VALUES (?)", id)
	}

	for i, id := range old.Recent {
		db.Exec("INSERT OR IGNORE INTO recent (track_id, position) VALUES (?, ?)", id, i)
	}

	for _, p := range old.Playlists {
		db.Exec("INSERT OR IGNORE INTO playlists (id, name, created_at) VALUES (?, ?, ?)", p.ID, p.Name, p.CreatedAt)
		for i, tid := range p.TrackIDs {
			db.Exec("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", p.ID, tid, i)
		}
	}

	if len(old.Favorites) > 0 || len(old.Recent) > 0 || len(old.Playlists) > 0 {
		os.Rename(jsonPath, jsonPath+".bak")
		log.Printf("Migration complete, old file backed up")
	}
}

func dbGetFavorites() []string {
	rows, err := db.Query("SELECT track_id FROM favorites ORDER BY added_at DESC")
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids
}

func dbToggleFavorite(trackID string) bool {
	var exists bool
	db.QueryRow("SELECT 1 FROM favorites WHERE track_id = ?", trackID).Scan(&exists)
	if exists {
		db.Exec("DELETE FROM favorites WHERE track_id = ?", trackID)
		return false
	}
	db.Exec("INSERT INTO favorites (track_id, added_at) VALUES (?, ?)", trackID, time.Now().Unix())
	return true
}

func dbIsFavorite(trackID string) bool {
	var exists bool
	db.QueryRow("SELECT 1 FROM favorites WHERE track_id = ?", trackID).Scan(&exists)
	return exists
}

func dbGetRecent() []string {
	rows, err := db.Query("SELECT track_id FROM recent ORDER BY position ASC")
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids
}

func dbAddRecent(trackID string) {
	db.Exec("DELETE FROM recent WHERE track_id = ?", trackID)
	db.Exec("UPDATE recent SET position = position + 1")
	db.Exec("INSERT INTO recent (track_id, position) VALUES (?, 0)", trackID)

	rows, _ := db.Query("SELECT track_id FROM recent ORDER BY position ASC LIMIT -1 OFFSET 50")
	defer rows.Close()
	for rows.Next() {
		var id string
		rows.Scan(&id)
		db.Exec("DELETE FROM recent WHERE track_id = ?", id)
	}
}

func dbGetPlaylists() []models.Playlist {
	rows, err := db.Query("SELECT id, name, created_at FROM playlists ORDER BY rowid")
	if err != nil {
		return []models.Playlist{}
	}
	defer rows.Close()

	var pls []models.Playlist
	for rows.Next() {
		var p models.Playlist
		rows.Scan(&p.ID, &p.Name, &p.CreatedAt)
		p.TrackIDs = dbGetPlaylistTracks(p.ID)
		pls = append(pls, p)
	}
	if pls == nil {
		pls = []models.Playlist{}
	}
	return pls
}

func dbGetPlaylistTracks(playlistID string) []string {
	rows, err := db.Query("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC", playlistID)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids
}

func dbCreatePlaylist(name string) models.Playlist {
	id := models.GenerateUUID()
	now := models.TimeNow()
	db.Exec("INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)", id, name, now)
	return models.Playlist{ID: id, Name: name, CreatedAt: now, TrackIDs: []string{}}
}

func dbUpdatePlaylist(id string, name string, trackIDs []string) {
	if name != "" {
		db.Exec("UPDATE playlists SET name = ? WHERE id = ?", name, id)
	}
	if trackIDs != nil {
		db.Exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", id)
		for i, tid := range trackIDs {
			db.Exec("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", id, tid, i)
		}
	}
}

func dbAddTrackToPlaylist(playlistID, trackID string) {
	var maxPos int
	row := db.QueryRow("SELECT COALESCE(MAX(position),-1) FROM playlist_tracks WHERE playlist_id = ?", playlistID)
	row.Scan(&maxPos)
	db.Exec("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", playlistID, trackID, maxPos+1)
}

func dbFindPlaylistByName(name string) *models.Playlist {
	row := db.QueryRow("SELECT id, name, created_at FROM playlists WHERE name = ? LIMIT 1", name)
	var p models.Playlist
	if err := row.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
		return nil
	}
	p.TrackIDs = dbGetPlaylistTracks(p.ID)
	return &p
}

func dbFindPlaylistByID(id string) *models.Playlist {
	row := db.QueryRow("SELECT id, name, created_at FROM playlists WHERE id = ? LIMIT 1", id)
	var p models.Playlist
	if err := row.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
		return nil
	}
	p.TrackIDs = dbGetPlaylistTracks(p.ID)
	return &p
}

func dbGetOrCreatePlaylistByName(name string) string {
	existing := dbFindPlaylistByName(name)
	if existing != nil {
		return existing.ID
	}
	p := dbCreatePlaylist(name)
	return p.ID
}

func dbDeletePlaylist(id string) bool {
	res, _ := db.Exec("DELETE FROM playlists WHERE id = ?", id)
	affected, _ := res.RowsAffected()
	db.Exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", id)
	return affected > 0
}

func dbInsertMetadataMatch(m *models.MetadataMatch) {
	db.Exec(`INSERT OR IGNORE INTO metadata_matches
		(id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.TrackID, m.TrackTitle, m.TrackArtist, m.MBTitle, m.MBArtist, m.MBAlbum, m.MBAlbumID, m.MBScore, m.Status)
}

func dbGetPendingMatches() []models.MetadataMatch {
	rows, err := db.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score
		FROM metadata_matches WHERE status = 'pending' ORDER BY mb_score DESC`)
	if err != nil {
		return []models.MetadataMatch{}
	}
	defer rows.Close()

	var matches []models.MetadataMatch
	for rows.Next() {
		var m models.MetadataMatch
		rows.Scan(&m.ID, &m.TrackID, &m.TrackTitle, &m.TrackArtist, &m.MBTitle, &m.MBArtist, &m.MBAlbum, &m.MBAlbumID, &m.MBScore)
		matches = append(matches, m)
	}
	if matches == nil {
		matches = []models.MetadataMatch{}
	}
	return matches
}

func dbGetAllMatches() []models.MetadataMatch {
	rows, err := db.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status
		FROM metadata_matches ORDER BY status, mb_score DESC`)
	if err != nil {
		return []models.MetadataMatch{}
	}
	defer rows.Close()

	var matches []models.MetadataMatch
	for rows.Next() {
		var m models.MetadataMatch
		rows.Scan(&m.ID, &m.TrackID, &m.TrackTitle, &m.TrackArtist, &m.MBTitle, &m.MBArtist, &m.MBAlbum, &m.MBAlbumID, &m.MBScore, &m.Status)
		matches = append(matches, m)
	}
	if matches == nil {
		matches = []models.MetadataMatch{}
	}
	return matches
}

func dbApproveMatch(id string) bool {
	var trackID, mbTitle, mbArtist, mbAlbum, mbAlbumID string
	var mbScore float64
	err := db.QueryRow(`SELECT track_id, mb_title, mb_artist, mb_album, mb_album_id, mb_score
		FROM metadata_matches WHERE id = ? AND status = 'pending'`, id).Scan(&trackID, &mbTitle, &mbArtist, &mbAlbum, &mbAlbumID, &mbScore)
	if err != nil {
		return false
	}

	res, err := db.Exec(`UPDATE metadata_matches SET status = 'approved' WHERE id = ?`, id)
	if err != nil {
		return false
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return false
	}

	db.Exec(`DELETE FROM metadata_matches WHERE track_id = ? AND id != ? AND status = 'pending'`, trackID, id)

	return true
}

func dbRejectMatch(id string) bool {
	res, err := db.Exec(`UPDATE metadata_matches SET status = 'rejected' WHERE id = ?`, id)
	if err != nil {
		return false
	}
	affected, _ := res.RowsAffected()
	return affected > 0
}

func dbApproveAllMatches() int {
	res, _ := db.Exec(`UPDATE metadata_matches SET status = 'approved' WHERE status = 'pending' AND mb_score >= 0.8`)
	affected, _ := res.RowsAffected()

	rows, _ := db.Query(`SELECT track_id FROM metadata_matches WHERE status = 'approved'`)
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var tid string
		rows.Scan(&tid)
		if seen[tid] {
			db.Exec(`DELETE FROM metadata_matches WHERE track_id = ? AND status = 'pending'`, tid)
		}
		seen[tid] = true
	}

	return int(affected)
}

func dbClearMatches() {
	db.Exec(`DELETE FROM metadata_matches`)
}

func dbUndoMatch(id string) (string, bool) {
	var trackID string
	err := db.QueryRow(`SELECT track_id FROM metadata_matches WHERE id = ? AND status = 'approved'`, id).Scan(&trackID)
	if err != nil {
		return "", false
	}

	db.Exec(`UPDATE metadata_matches SET status = 'pending' WHERE id = ?`, id)
	db.Exec(`UPDATE tracks SET
		title = CASE WHEN orig_title != '' THEN orig_title ELSE title END,
		artist = CASE WHEN orig_artist != '' THEN orig_artist ELSE artist END,
		album = CASE WHEN orig_album != '' THEN orig_album ELSE album END,
		album_artist = CASE WHEN orig_album_artist != '' THEN orig_album_artist ELSE album_artist END,
		album_id = CASE WHEN orig_album_id != '' THEN orig_album_id ELSE album_id END,
		has_metadata = 0
		WHERE id = ?`, trackID)

	return trackID, true
}

func dbGetMatchCount() map[string]int {
	counts := map[string]int{"pending": 0, "approved": 0, "rejected": 0}
	rows, err := db.Query(`SELECT status, COUNT(*) FROM metadata_matches GROUP BY status`)
	if err != nil {
		return counts
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		rows.Scan(&status, &count)
		counts[status] = count
	}
	return counts
}

// --- Track / Album persistence ---

type dbExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func dbUpsertTrack(t *models.Track) {
	dbUpsertTrackWith(db, t)
}

func dbUpsertTrackTx(tx *sql.Tx, t *models.Track) {
	dbUpsertTrackWith(tx, t)
}

func dbUpsertTrackWith(e dbExecer, t *models.Track) {
	e.Exec(`INSERT INTO tracks (id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title=CASE WHEN tracks.has_metadata = 1 THEN tracks.title ELSE excluded.title END,
			artist=CASE WHEN tracks.has_metadata = 1 THEN tracks.artist ELSE excluded.artist END,
			album=CASE WHEN tracks.has_metadata = 1 THEN tracks.album ELSE excluded.album END,
			album_artist=CASE WHEN tracks.has_metadata = 1 THEN tracks.album_artist ELSE excluded.album_artist END,
			album_id=CASE WHEN tracks.has_metadata = 1 THEN tracks.album_id ELSE excluded.album_id END,
			track_number=CASE WHEN tracks.has_metadata = 1 THEN tracks.track_number ELSE excluded.track_number END,
			year=CASE WHEN tracks.has_metadata = 1 THEN tracks.year ELSE excluded.year END,
			genre=CASE WHEN tracks.has_metadata = 1 THEN tracks.genre ELSE excluded.genre END,
			duration=CASE WHEN tracks.duration > 0 THEN tracks.duration ELSE excluded.duration END,
			has_cover=excluded.has_cover,
			mod_time=excluded.mod_time,
			has_metadata=CASE WHEN tracks.has_metadata = 1 THEN 1 ELSE excluded.has_metadata END`,
		t.ID, t.Title, t.Artist, t.Album, t.AlbumArtist, t.AlbumID,
		t.TrackNumber, t.Year, t.Genre, t.Duration, t.FilePath,
		boolToInt(t.HasCover), t.ModTime, boolToInt(t.HasMetadata))
}

func dbUpsertAlbum(a *models.Album) {
	dbUpsertAlbumWith(db, a)
}

func dbUpsertAlbumTx(tx *sql.Tx, a *models.Album) {
	dbUpsertAlbumWith(tx, a)
}

func dbUpsertAlbumWith(e dbExecer, a *models.Album) {
	e.Exec(`INSERT INTO albums (id, name, artist, track_count, year, has_cover)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, artist=excluded.artist,
			track_count=excluded.track_count, year=excluded.year, has_cover=excluded.has_cover`,
		a.ID, a.Name, a.Artist, a.TrackCount, a.Year, boolToInt(a.HasCover))
}

func dbUpdateTrackMetadata(trackID, title, artist, album, albumArtist string) {
	albumID := ""
	if album != "" {
		albumID = models.GenerateAlbumID(albumArtist, album)
	}
	db.Exec(`UPDATE tracks SET
		orig_title = CASE WHEN orig_title = '' AND has_metadata = 0 THEN title ELSE orig_title END,
		orig_artist = CASE WHEN orig_artist = '' AND has_metadata = 0 THEN artist ELSE orig_artist END,
		orig_album = CASE WHEN orig_album = '' AND has_metadata = 0 THEN album ELSE orig_album END,
		orig_album_artist = CASE WHEN orig_album_artist = '' AND has_metadata = 0 THEN album_artist ELSE orig_album_artist END,
		orig_album_id = CASE WHEN orig_album_id = '' AND has_metadata = 0 THEN album_id ELSE orig_album_id END,
		title=?, artist=?, album=?, album_artist=?, album_id=?, has_metadata=1 WHERE id=?`,
		title, artist, album, albumArtist, albumID, trackID)
}

func dbLoadTracks() map[string]*models.Track {
	rows, err := db.Query(`SELECT id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata FROM tracks`)
	if err != nil {
		return map[string]*models.Track{}
	}
	defer rows.Close()

	disabled := map[string]bool{}
	dRows, err := db.Query("SELECT track_id FROM downloads WHERE disabled = 1")
	if err == nil {
		for dRows.Next() {
			var id string
			if dRows.Scan(&id) == nil {
				disabled[id] = true
			}
		}
		dRows.Close()
	}

	result := make(map[string]*models.Track)
	for rows.Next() {
		t := &models.Track{}
		var hasCover, hasMetadata int
		rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Album, &t.AlbumArtist, &t.AlbumID,
			&t.TrackNumber, &t.Year, &t.Genre, &t.Duration, &t.FilePath,
			&hasCover, &t.ModTime, &hasMetadata)
		t.HasCover = hasCover == 1
		t.HasMetadata = hasMetadata == 1
		t.DownloadEnabled = !disabled[t.ID]
		result[t.ID] = t
	}
	return result
}

func dbLoadAlbums() map[string]*models.Album {
	rows, err := db.Query(`SELECT id, name, artist, track_count, year, has_cover FROM albums`)
	if err != nil {
		return map[string]*models.Album{}
	}
	defer rows.Close()

	result := make(map[string]*models.Album)
	for rows.Next() {
		a := &models.Album{}
		var hasCover int
		rows.Scan(&a.ID, &a.Name, &a.Artist, &a.TrackCount, &a.Year, &hasCover)
		a.HasCover = hasCover == 1
		result[a.ID] = a
	}
	return result
}

func dbDeleteTrack(trackID string) {
	db.Exec(`DELETE FROM tracks WHERE id=?`, trackID)
}

func dbDeleteAlbum(albumID string) {
	db.Exec(`DELETE FROM albums WHERE id=?`, albumID)
}

func dbCleanupFavorites() {
	db.Exec(`DELETE FROM favorites WHERE track_id NOT IN (SELECT id FROM tracks)`)
}

func dbCleanupRecent() {
	db.Exec(`DELETE FROM recent WHERE track_id NOT IN (SELECT id FROM tracks)`)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// --- Download management ---

func dbToggleDownload(trackID string) bool {
	var disabled int
	err := db.QueryRow("SELECT disabled FROM downloads WHERE track_id = ?", trackID).Scan(&disabled)
	if err != nil {
		db.Exec("INSERT INTO downloads (track_id, disabled) VALUES (?, 1)", trackID)
		return false
	}
	if disabled == 1 {
		db.Exec("UPDATE downloads SET disabled = 0 WHERE track_id = ?", trackID)
		return true
	}
	db.Exec("UPDATE downloads SET disabled = 1 WHERE track_id = ?", trackID)
	return false
}

func dbIsDownloadable(trackID string) bool {
	var disabled int
	err := db.QueryRow("SELECT disabled FROM downloads WHERE track_id = ?", trackID).Scan(&disabled)
	if err != nil {
		return true
	}
	return disabled == 0
}

func dbGetDownloadableTracks() []string {
	rows, err := db.Query("SELECT track_id, disabled FROM downloads")
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	blacklist := map[string]bool{}
	for rows.Next() {
		var id string
		var disabled int
		if rows.Scan(&id, &disabled) == nil && disabled == 1 {
			blacklist[id] = true
		}
	}
	mu.RLock()
	defer mu.RUnlock()
	var ids []string
	for _, t := range tracks {
		if !blacklist[t.ID] {
			ids = append(ids, t.ID)
		}
	}
	if ids == nil {
		ids = []string{}
	}
	return ids
}

func dbSaveSharedQueue(trackIDs string) string {
	id := uuid.New().String()[:8]
	now := time.Now().Format(time.RFC3339)
	db.Exec("INSERT INTO shared_queues (id, track_ids, created_at) VALUES (?, ?, ?)", id, trackIDs, now)
	return id
}

func dbGetSharedQueue(queueID string) ([]string, error) {
	var trackIDs string
	err := db.QueryRow("SELECT track_ids FROM shared_queues WHERE id = ?", queueID).Scan(&trackIDs)
	if err != nil {
		return nil, err
	}
	var result []string
	json.Unmarshal([]byte(trackIDs), &result)
	return result, nil
}

func dbEnableAllDownloads() {
	db.Exec("DELETE FROM downloads WHERE disabled = 1")
}
