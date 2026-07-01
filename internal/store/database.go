package store

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

func InitDB(path string) {
	dir := filepath.Dir(path)
	os.MkdirAll(dir, 0755)

	var err error
	DB, err = sql.Open("sqlite", path)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	DBPath = path

	DB.Exec("PRAGMA journal_mode=WAL")
	DB.Exec("PRAGMA busy_timeout=5000")

	DB.Exec(`CREATE TABLE IF NOT EXISTS favorites (
		track_id TEXT PRIMARY KEY,
		added_at INTEGER NOT NULL DEFAULT 0
	)`)

	DB.Exec(`ALTER TABLE favorites ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS recent (
		track_id TEXT PRIMARY KEY,
		position INTEGER NOT NULL
	)`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS playlists (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS playlist_tracks (
		playlist_id TEXT NOT NULL,
		track_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (playlist_id, track_id)
	)`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS metadata_matches (
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

	DB.Exec(`CREATE TABLE IF NOT EXISTS tracks (
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

	DB.Exec(`CREATE TABLE IF NOT EXISTS albums (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		artist TEXT NOT NULL DEFAULT '',
		track_count INTEGER NOT NULL DEFAULT 0,
		year INTEGER NOT NULL DEFAULT 0,
		has_cover INTEGER NOT NULL DEFAULT 0
	)`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS downloads (
		track_id TEXT PRIMARY KEY,
		disabled INTEGER NOT NULL DEFAULT 0
	)`)
	DB.Exec(`ALTER TABLE downloads ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS shared_queues (
		id TEXT PRIMARY KEY,
		track_ids TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS custom_covers (
		album_id TEXT PRIMARY KEY
	)`)

	// Add orig_* columns for undo support (SQLite ALTER TABLE ADD COLUMN is safe)
	DB.Exec(`ALTER TABLE tracks ADD COLUMN orig_title TEXT NOT NULL DEFAULT ''`)
	DB.Exec(`ALTER TABLE tracks ADD COLUMN orig_artist TEXT NOT NULL DEFAULT ''`)
	DB.Exec(`ALTER TABLE tracks ADD COLUMN orig_album TEXT NOT NULL DEFAULT ''`)
	DB.Exec(`ALTER TABLE tracks ADD COLUMN orig_album_artist TEXT NOT NULL DEFAULT ''`)
	DB.Exec(`ALTER TABLE tracks ADD COLUMN orig_album_id TEXT NOT NULL DEFAULT ''`)

	// Add added_at to favorites for ordering (newest first)
	DB.Exec(`ALTER TABLE favorites ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)

	dedupTracksByFilePath()
	DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path)`)

	InitSettingsTable()

	MigrateFromJSON()
}

// dedupTracksByFilePath merges any tracks sharing the same file_path,
// keeping the one with the most metadata. References in all related tables
// are migrated to the survivor before deleting the losers.
// Also deduplicates across media: prefix (same file in primary + media dirs).
func dedupTracksByFilePath() {
	// Pass 1: exact file_path duplicates
	rows, err := DB.Query(`SELECT file_path, COUNT(*) as cnt FROM tracks GROUP BY file_path HAVING cnt > 1`)
	if err == nil {
		var dupPaths []string
		for rows.Next() {
			var p string
			var c int
			rows.Scan(&p, &c)
			dupPaths = append(dupPaths, p)
		}
		rows.Close()
		if len(dupPaths) > 0 {
			log.Printf("[db] Found %d exact duplicate file_paths, deduplicating...", len(dupPaths))
			for _, path := range dupPaths {
				dedupByFilePath(path)
			}
		}
	}

	// Pass 2: cross-prefix duplicates (same relative path, one with media: prefix, one without)
	rows, err = DB.Query(`SELECT REPLACE(file_path, 'media:', '') as norm, COUNT(*) as cnt FROM tracks GROUP BY norm HAVING cnt > 1`)
	if err == nil {
		type crossPair struct{ normPath string }
		var pairs []crossPair
		for rows.Next() {
			var p string
			var c int
			rows.Scan(&p, &c)
			pairs = append(pairs, crossPair{normPath: p})
		}
		rows.Close()
		if len(pairs) > 0 {
			log.Printf("[db] Found %d cross-prefix duplicate paths, deduplicating...", len(pairs))
			for _, pair := range pairs {
				// Find all tracks whose normalized path matches
				r, err := DB.Query(`SELECT id, file_path, has_metadata, mod_time FROM tracks WHERE file_path = ? OR file_path = ? ORDER BY has_metadata DESC, mod_time DESC`,
					pair.normPath, "media:"+pair.normPath)
				if err != nil {
					continue
				}
				var ids []string
				for r.Next() {
					var id, fp string
					var hm int
					var mt int64
					r.Scan(&id, &fp, &hm, &mt)
					ids = append(ids, id)
				}
				r.Close()
				if len(ids) <= 1 {
					continue
				}
				keepID := ids[0]
				tx, _ := DB.Begin()
				for _, dupID := range ids[1:] {
					tx.Exec(`UPDATE OR IGNORE favorites SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`UPDATE OR IGNORE recent SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`UPDATE OR IGNORE downloads SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`UPDATE OR IGNORE metadata_matches SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`UPDATE OR IGNORE track_reviews SET track_id = ? WHERE track_id = ?`, keepID, dupID)
					tx.Exec(`DELETE FROM tracks WHERE id = ?`, dupID)
				}
				tx.Commit()
				log.Printf("[db] Cross-prefix deduped %s: kept %s, removed %d", pair.normPath, keepID, len(ids)-1)
			}
		}
	}
}

func dedupByFilePath(path string) {
	rows, err := DB.Query(`SELECT id FROM tracks WHERE file_path = ? ORDER BY has_metadata DESC, mod_time DESC`, path)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) <= 1 {
		return
	}
	keepID := ids[0]
	tx, _ := DB.Begin()
	for _, dupID := range ids[1:] {
		tx.Exec(`UPDATE OR IGNORE favorites SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`UPDATE OR IGNORE recent SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`UPDATE OR IGNORE downloads SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`UPDATE OR IGNORE metadata_matches SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`UPDATE OR IGNORE track_reviews SET track_id = ? WHERE track_id = ?`, keepID, dupID)
		tx.Exec(`DELETE FROM tracks WHERE id = ?`, dupID)
	}
	tx.Commit()
	log.Printf("[db] Deduped %s: kept %s, removed %d", path, keepID, len(ids)-1)
}

func MigrateFromJSON() {
	jsonPath := filepath.Join(filepath.Dir(DBPath), "state.json")
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
		DB.Exec("INSERT OR IGNORE INTO favorites (track_id) VALUES (?)", id)
	}

	for i, id := range old.Recent {
		DB.Exec("INSERT OR IGNORE INTO recent (track_id, position) VALUES (?, ?)", id, i)
	}

	for _, p := range old.Playlists {
		DB.Exec("INSERT OR IGNORE INTO playlists (id, name, created_at) VALUES (?, ?, ?)", p.ID, p.Name, p.CreatedAt)
		for i, tid := range p.TrackIDs {
			DB.Exec("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", p.ID, tid, i)
		}
	}

	if len(old.Favorites) > 0 || len(old.Recent) > 0 || len(old.Playlists) > 0 {
		os.Rename(jsonPath, jsonPath+".bak")
		log.Printf("Migration complete, old file backed up")
	}
}

func DbGetFavorites() []string {
	rows, err := DB.Query("SELECT track_id FROM favorites ORDER BY added_at DESC")
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

func DbToggleFavorite(trackID string) bool {
	var exists bool
	DB.QueryRow("SELECT 1 FROM favorites WHERE track_id = ?", trackID).Scan(&exists)
	if exists {
		DB.Exec("DELETE FROM favorites WHERE track_id = ?", trackID)
		return false
	}
	DB.Exec("INSERT INTO favorites (track_id, added_at) VALUES (?, ?)", trackID, time.Now().Unix())
	return true
}

func DbIsFavorite(trackID string) bool {
	var exists bool
	DB.QueryRow("SELECT 1 FROM favorites WHERE track_id = ?", trackID).Scan(&exists)
	return exists
}

func DbGetRecent() []string {
	rows, err := DB.Query("SELECT track_id FROM recent ORDER BY position ASC")
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

func DbAddRecent(trackID string) {
	DB.Exec("DELETE FROM recent WHERE track_id = ?", trackID)
	DB.Exec("UPDATE recent SET position = position + 1")
	DB.Exec("INSERT INTO recent (track_id, position) VALUES (?, 0)", trackID)
	DB.Exec("DELETE FROM recent WHERE rowid NOT IN (SELECT rowid FROM recent ORDER BY position ASC LIMIT 50)")
}

func DbGetPlaylists() []models.Playlist {
	rows, err := DB.Query("SELECT id, name, created_at FROM playlists ORDER BY rowid")
	if err != nil {
		return []models.Playlist{}
	}
	defer rows.Close()

	var pls []models.Playlist
	for rows.Next() {
		var p models.Playlist
		rows.Scan(&p.ID, &p.Name, &p.CreatedAt)
		p.TrackIDs = DbGetPlaylistTracks(p.ID)
		pls = append(pls, p)
	}
	if pls == nil {
		pls = []models.Playlist{}
	}
	return pls
}

func DbGetPlaylistTracks(playlistID string) []string {
	rows, err := DB.Query("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC", playlistID)
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

func DbCreatePlaylist(name string) models.Playlist {
	id := models.GenerateUUID()
	now := models.TimeNow()
	DB.Exec("INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)", id, name, now)
	return models.Playlist{ID: id, Name: name, CreatedAt: now, TrackIDs: []string{}}
}

func DbUpdatePlaylist(id string, name string, trackIDs []string) {
	if name != "" {
		DB.Exec("UPDATE playlists SET name = ? WHERE id = ?", name, id)
	}
	if trackIDs != nil {
		DB.Exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", id)
		for i, tid := range trackIDs {
			DB.Exec("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", id, tid, i)
		}
	}
}

func DbAddTrackToPlaylist(playlistID, trackID string) {
	var maxPos int
	row := DB.QueryRow("SELECT COALESCE(MAX(position),-1) FROM playlist_tracks WHERE playlist_id = ?", playlistID)
	row.Scan(&maxPos)
	DB.Exec("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", playlistID, trackID, maxPos+1)
}

func DbFindPlaylistByName(name string) *models.Playlist {
	row := DB.QueryRow("SELECT id, name, created_at FROM playlists WHERE name = ? LIMIT 1", name)
	var p models.Playlist
	if err := row.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
		return nil
	}
	p.TrackIDs = DbGetPlaylistTracks(p.ID)
	return &p
}

func DbFindPlaylistByID(id string) *models.Playlist {
	row := DB.QueryRow("SELECT id, name, created_at FROM playlists WHERE id = ? LIMIT 1", id)
	var p models.Playlist
	if err := row.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
		return nil
	}
	p.TrackIDs = DbGetPlaylistTracks(p.ID)
	return &p
}

func DbGetOrCreatePlaylistByName(name string) string {
	existing := DbFindPlaylistByName(name)
	if existing != nil {
		return existing.ID
	}
	p := DbCreatePlaylist(name)
	return p.ID
}

func DbDeletePlaylist(id string) bool {
	res, _ := DB.Exec("DELETE FROM playlists WHERE id = ?", id)
	affected, _ := res.RowsAffected()
	DB.Exec("DELETE FROM playlist_tracks WHERE playlist_id = ?", id)
	return affected > 0
}

func DbInsertMetadataMatch(m *models.MetadataMatch) {
	DB.Exec(`INSERT OR IGNORE INTO metadata_matches
		(id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.TrackID, m.TrackTitle, m.TrackArtist, m.MBTitle, m.MBArtist, m.MBAlbum, m.MBAlbumID, m.MBScore, m.Status)
}

func DbGetPendingMatches() []models.MetadataMatch {
	rows, err := DB.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score
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

func DbGetAllMatches() []models.MetadataMatch {
	rows, err := DB.Query(`SELECT id, track_id, track_title, track_artist, mb_title, mb_artist, mb_album, mb_album_id, mb_score, status
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

func DbApproveMatch(id string) bool {
	var trackID, mbTitle, mbArtist, mbAlbum, mbAlbumID string
	var mbScore float64
	err := DB.QueryRow(`SELECT track_id, mb_title, mb_artist, mb_album, mb_album_id, mb_score
		FROM metadata_matches WHERE id = ? AND status = 'pending'`, id).Scan(&trackID, &mbTitle, &mbArtist, &mbAlbum, &mbAlbumID, &mbScore)
	if err != nil {
		return false
	}

	res, err := DB.Exec(`UPDATE metadata_matches SET status = 'approved' WHERE id = ?`, id)
	if err != nil {
		return false
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return false
	}

	DB.Exec(`DELETE FROM metadata_matches WHERE track_id = ? AND id != ? AND status = 'pending'`, trackID, id)

	return true
}

func DbRejectMatch(id string) bool {
	res, err := DB.Exec(`UPDATE metadata_matches SET status = 'rejected' WHERE id = ?`, id)
	if err != nil {
		return false
	}
	affected, _ := res.RowsAffected()
	return affected > 0
}

func DbApproveAllMatches() int {
	res, err := DB.Exec(`UPDATE metadata_matches SET status = 'approved' WHERE status = 'pending' AND mb_score >= 0.8`)
	if err != nil {
		return 0
	}
	affected, _ := res.RowsAffected()

	rows, err := DB.Query(`SELECT track_id FROM metadata_matches WHERE status = 'approved'`)
	if err != nil {
		return int(affected)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var tid string
		rows.Scan(&tid)
		if seen[tid] {
			DB.Exec(`DELETE FROM metadata_matches WHERE track_id = ? AND status = 'pending'`, tid)
		}
		seen[tid] = true
	}

	return int(affected)
}

func DbClearMatches() {
	DB.Exec(`DELETE FROM metadata_matches`)
}

func DbUndoMatch(id string) (string, bool) {
	var trackID string
	err := DB.QueryRow(`SELECT track_id FROM metadata_matches WHERE id = ? AND status = 'approved'`, id).Scan(&trackID)
	if err != nil {
		return "", false
	}

	DB.Exec(`UPDATE metadata_matches SET status = 'pending' WHERE id = ?`, id)
	DB.Exec(`UPDATE tracks SET
		title = CASE WHEN orig_title != '' THEN orig_title ELSE title END,
		artist = CASE WHEN orig_artist != '' THEN orig_artist ELSE artist END,
		album = CASE WHEN orig_album != '' THEN orig_album ELSE album END,
		album_artist = CASE WHEN orig_album_artist != '' THEN orig_album_artist ELSE album_artist END,
		album_id = CASE WHEN orig_album_id != '' THEN orig_album_id ELSE album_id END,
		has_metadata = 0
		WHERE id = ?`, trackID)

	return trackID, true
}

func DbGetMatchCount() map[string]int {
	counts := map[string]int{"pending": 0, "approved": 0, "rejected": 0}
	rows, err := DB.Query(`SELECT status, COUNT(*) FROM metadata_matches GROUP BY status`)
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

type DbExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func DbUpsertTrack(t *models.Track) {
	DbUpsertTrackWith(DB, t)
}

func DbUpsertTrackTx(tx *sql.Tx, t *models.Track) {
	DbUpsertTrackWith(tx, t)
}

func DbUpsertTrackWith(e DbExecer, t *models.Track) {
	// Ultimate backstop: never persist tracks from the Soulseek share folder.
	if IsInSlskShareDir(t.FilePath) {
		return
	}
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
		BoolToInt(t.HasCover), t.ModTime, BoolToInt(t.HasMetadata))
}

func DbUpsertAlbum(a *models.Album) {
	DbUpsertAlbumWith(DB, a)
}

func DbUpsertAlbumTx(tx *sql.Tx, a *models.Album) {
	DbUpsertAlbumWith(tx, a)
}

func DbUpsertAlbumWith(e DbExecer, a *models.Album) {
	e.Exec(`INSERT INTO albums (id, name, artist, track_count, year, has_cover)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, artist=excluded.artist,
			track_count=excluded.track_count, year=excluded.year, has_cover=excluded.has_cover`,
		a.ID, a.Name, a.Artist, a.TrackCount, a.Year, BoolToInt(a.HasCover))
}

func DbUpdateTrackMetadata(trackID, title, artist, album, albumArtist string) {
	albumID := ""
	if album != "" {
		albumID = models.GenerateAlbumID(albumArtist, album)
	}
	DB.Exec(`UPDATE tracks SET
		orig_title = CASE WHEN orig_title = '' AND has_metadata = 0 THEN title ELSE orig_title END,
		orig_artist = CASE WHEN orig_artist = '' AND has_metadata = 0 THEN artist ELSE orig_artist END,
		orig_album = CASE WHEN orig_album = '' AND has_metadata = 0 THEN album ELSE orig_album END,
		orig_album_artist = CASE WHEN orig_album_artist = '' AND has_metadata = 0 THEN album_artist ELSE orig_album_artist END,
		orig_album_id = CASE WHEN orig_album_id = '' AND has_metadata = 0 THEN album_id ELSE orig_album_id END,
		title=?, artist=?, album=?, album_artist=?, album_id=?, has_metadata=1 WHERE id=?`,
		title, artist, album, albumArtist, albumID, trackID)
}

func DbLoadTracks() map[string]*models.Track {
	rows, err := DB.Query(`SELECT id, title, artist, album, album_artist, album_id, track_number, year, genre, duration, file_path, has_cover, mod_time, has_metadata FROM tracks`)
	if err != nil {
		return map[string]*models.Track{}
	}
	defer rows.Close()

	disabled := map[string]bool{}
	dRows, err := DB.Query("SELECT track_id FROM downloads WHERE disabled = 1")
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

func DbLoadAlbums() map[string]*models.Album {
	rows, err := DB.Query(`SELECT id, name, artist, track_count, year, has_cover FROM albums`)
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

func DbDeleteTrack(trackID string) {
	tx, err := DB.Begin()
	if err != nil {
		DB.Exec(`DELETE FROM tracks WHERE id=?`, trackID)
		return
	}
	defer tx.Rollback()
	tx.Exec(`DELETE FROM tracks WHERE id=?`, trackID)
	tx.Exec(`DELETE FROM favorites WHERE track_id=?`, trackID)
	tx.Exec(`DELETE FROM recent WHERE track_id=?`, trackID)
	tx.Exec(`DELETE FROM playlist_tracks WHERE track_id=?`, trackID)
	tx.Exec(`DELETE FROM downloads WHERE track_id=?`, trackID)
	tx.Exec(`DELETE FROM metadata_matches WHERE track_id=?`, trackID)
	tx.Exec(`DELETE FROM track_reviews WHERE track_id=?`, trackID)
	tx.Commit()
}

func DbDeleteAlbum(albumID string) {
	DB.Exec(`DELETE FROM albums WHERE id=?`, albumID)
}

func DbCleanupFavorites() {
	DB.Exec(`DELETE FROM favorites WHERE track_id NOT IN (SELECT id FROM tracks)`)
}

func DbCleanupRecent() {
	DB.Exec(`DELETE FROM recent WHERE track_id NOT IN (SELECT id FROM tracks)`)
}

func DbCleanupPlaylistTracks() {
	DB.Exec(`DELETE FROM playlist_tracks WHERE track_id NOT IN (SELECT id FROM tracks)`)
}

// DbMigrateTrackID updates a track's ID and file_path and cascades the new ID
// to every referencing table. Used by AutoSort when moving files to preserve
// user data (favorites, playlists, reviews) across path changes.
func DbMigrateTrackID(oldID, newID, newPath string) {
	tx, err := DB.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()

	// If newID already exists (file was already scanned at the new path),
	// merge: migrate old references to the existing row, delete the old row.
	var exists int
	tx.QueryRow(`SELECT COUNT(*) FROM tracks WHERE id = ?`, newID).Scan(&exists)
	if exists > 0 {
		tx.Exec(`UPDATE OR IGNORE favorites SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`UPDATE OR IGNORE recent SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`UPDATE OR IGNORE downloads SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`UPDATE OR IGNORE metadata_matches SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`UPDATE OR IGNORE track_reviews SET track_id = ? WHERE track_id = ?`, newID, oldID)
		tx.Exec(`DELETE FROM tracks WHERE id = ?`, oldID)
	} else {
		tx.Exec(`UPDATE tracks SET id=?, file_path=? WHERE id=?`, newID, newPath, oldID)
		tx.Exec(`UPDATE favorites SET track_id=? WHERE track_id=?`, newID, oldID)
		tx.Exec(`UPDATE recent SET track_id=? WHERE track_id=?`, newID, oldID)
		tx.Exec(`UPDATE playlist_tracks SET track_id=? WHERE track_id=?`, newID, oldID)
		tx.Exec(`UPDATE downloads SET track_id=? WHERE track_id=?`, newID, oldID)
		tx.Exec(`UPDATE metadata_matches SET track_id=? WHERE track_id=?`, newID, oldID)
		tx.Exec(`UPDATE track_reviews SET track_id=? WHERE track_id=?`, newID, oldID)
	}
	tx.Commit()
}

// --- Download management ---

func DbToggleDownload(trackID string) bool {
	var disabled int
	err := DB.QueryRow("SELECT disabled FROM downloads WHERE track_id = ?", trackID).Scan(&disabled)
	if err != nil {
		DB.Exec("INSERT INTO downloads (track_id, disabled) VALUES (?, 1)", trackID)
		return false
	}
	if disabled == 1 {
		DB.Exec("UPDATE downloads SET disabled = 0 WHERE track_id = ?", trackID)
		return true
	}
	DB.Exec("UPDATE downloads SET disabled = 1 WHERE track_id = ?", trackID)
	return false
}

func DbIsDownloadable(trackID string) bool {
	var disabled int
	err := DB.QueryRow("SELECT disabled FROM downloads WHERE track_id = ?", trackID).Scan(&disabled)
	if err != nil {
		return true
	}
	return disabled == 0
}

func DbGetDownloadableTracks() []string {
	rows, err := DB.Query("SELECT track_id, disabled FROM downloads")
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
	Mu.RLock()
	defer Mu.RUnlock()
	var ids []string
	for _, t := range Tracks {
		if !blacklist[t.ID] {
			ids = append(ids, t.ID)
		}
	}
	if ids == nil {
		ids = []string{}
	}
	return ids
}

func DbSaveSharedQueue(trackIDs string) string {
	id := uuid.New().String()[:8]
	now := time.Now().Format(time.RFC3339)
	DB.Exec("INSERT INTO shared_queues (id, track_ids, created_at) VALUES (?, ?, ?)", id, trackIDs, now)
	return id
}

func DbGetSharedQueue(queueID string) ([]string, error) {
	var trackIDs string
	err := DB.QueryRow("SELECT track_ids FROM shared_queues WHERE id = ?", queueID).Scan(&trackIDs)
	if err != nil {
		return nil, err
	}
	var result []string
	json.Unmarshal([]byte(trackIDs), &result)
	return result, nil
}

func DbEnableAllDownloads() {
	DB.Exec("DELETE FROM downloads WHERE disabled = 1")
}
