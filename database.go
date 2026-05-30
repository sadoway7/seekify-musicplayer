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
