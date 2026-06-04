package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"path/filepath"

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
		track_id TEXT PRIMARY KEY
	)`)

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

	migrateFromJSON()
}

func migrateFromJSON() {
	jsonPath := filepath.Join(filepath.Dir(dbPath), "state.json")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return
	}

	var old AppState
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
	rows, err := db.Query("SELECT track_id FROM favorites")
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
	db.Exec("INSERT INTO favorites (track_id) VALUES (?)", trackID)
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

func dbGetPlaylists() []Playlist {
	rows, err := db.Query("SELECT id, name, created_at FROM playlists ORDER BY rowid")
	if err != nil {
		return []Playlist{}
	}
	defer rows.Close()

	var pls []Playlist
	for rows.Next() {
		var p Playlist
		rows.Scan(&p.ID, &p.Name, &p.CreatedAt)
		p.TrackIDs = dbGetPlaylistTracks(p.ID)
		pls = append(pls, p)
	}
	if pls == nil {
		pls = []Playlist{}
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

func dbCreatePlaylist(name string) Playlist {
	id := generateUUID()
	now := timeNow()
	db.Exec("INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)", id, name, now)
	return Playlist{ID: id, Name: name, CreatedAt: now, TrackIDs: []string{}}
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

func dbDeletePlaylist(id string) bool {
	res, _ := db.Exec("DELETE FROM playlists WHERE id = ?", id)
	affected, _ := res.RowsAffected()
	db.Exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", id)
	return affected > 0
}

func dbInsertMetadataMatch(m *MetadataMatch) {
	db.Exec(`INSERT OR IGNORE INTO metadata_matches
		(id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.TrackID, m.TrackTitle, m.TrackArtist, m.MBTitle, m.MBArtist, m.MBAlbum, m.MBAlbumID, m.MBScore, m.Status)
}

func dbGetPendingMatches() []MetadataMatch {
	rows, err := db.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score
		FROM metadata_matches WHERE status = 'pending' ORDER BY mb_score DESC`)
	if err != nil {
		return []MetadataMatch{}
	}
	defer rows.Close()

	var matches []MetadataMatch
	for rows.Next() {
		var m MetadataMatch
		rows.Scan(&m.ID, &m.TrackID, &m.TrackTitle, &m.TrackArtist, &m.MBTitle, &m.MBArtist, &m.MBAlbum, &m.MBAlbumID, &m.MBScore)
		matches = append(matches, m)
	}
	if matches == nil {
		matches = []MetadataMatch{}
	}
	return matches
}

func dbGetAllMatches() []MetadataMatch {
	rows, err := db.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status
		FROM metadata_matches ORDER BY status, mb_score DESC`)
	if err != nil {
		return []MetadataMatch{}
	}
	defer rows.Close()

	var matches []MetadataMatch
	for rows.Next() {
		var m MetadataMatch
		rows.Scan(&m.ID, &m.TrackID, &m.TrackTitle, &m.TrackArtist, &m.MBTitle, &m.MBArtist, &m.MBAlbum, &m.MBAlbumID, &m.MBScore, &m.Status)
		matches = append(matches, m)
	}
	if matches == nil {
		matches = []MetadataMatch{}
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

func dbUpsertTrack(t *Track) {
	db.Exec(`INSERT INTO tracks (id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title=excluded.title, artist=excluded.artist, album=excluded.album,
			album_artist=excluded.album_artist, album_id=excluded.album_id,
			track_number=excluded.track_number, year=excluded.year, genre=excluded.genre,
			duration=excluded.duration, has_cover=excluded.has_cover,
			mod_time=excluded.mod_time, has_metadata=excluded.has_metadata`,
		t.ID, t.Title, t.Artist, t.Album, t.AlbumArtist, t.AlbumID,
		t.TrackNumber, t.Year, t.Genre, t.Duration, t.FilePath,
		boolToInt(t.HasCover), t.ModTime, boolToInt(t.HasMetadata))
}

func dbUpsertAlbum(a *Album) {
	db.Exec(`INSERT INTO albums (id, name, artist, track_count, year, has_cover)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, artist=excluded.artist,
			track_count=excluded.track_count, year=excluded.year, has_cover=excluded.has_cover`,
		a.ID, a.Name, a.Artist, a.TrackCount, a.Year, boolToInt(a.HasCover))
}

func dbUpdateTrackMetadata(trackID, title, artist, album, albumArtist string) {
	albumID := ""
	if album != "" {
		albumID = generateAlbumID(albumArtist, album)
	}
	db.Exec(`UPDATE tracks SET title=?, artist=?, album=?, album_artist=?, album_id=?, has_metadata=1 WHERE id=?`,
		title, artist, album, albumArtist, albumID, trackID)
}

func dbLoadTracks() map[string]*Track {
	rows, err := db.Query(`SELECT id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata FROM tracks`)
	if err != nil {
		return map[string]*Track{}
	}
	defer rows.Close()

	result := make(map[string]*Track)
	for rows.Next() {
		t := &Track{}
		var hasCover, hasMetadata int
		rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Album, &t.AlbumArtist, &t.AlbumID,
			&t.TrackNumber, &t.Year, &t.Genre, &t.Duration, &t.FilePath,
			&hasCover, &t.ModTime, &hasMetadata)
		t.HasCover = hasCover == 1
		t.HasMetadata = hasMetadata == 1
		result[t.ID] = t
	}
	return result
}

func dbLoadAlbums() map[string]*Album {
	rows, err := db.Query(`SELECT id, name, artist, track_count, year, has_cover FROM albums`)
	if err != nil {
		return map[string]*Album{}
	}
	defer rows.Close()

	result := make(map[string]*Album)
	for rows.Next() {
		a := &Album{}
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

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
