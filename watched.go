package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type WatchedPlaylist struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Name        string `json:"name"`
	TrackCount  int    `json:"trackCount"`
	LastRefresh string `json:"lastRefresh,omitempty"`
	CreatedAt   string `json:"createdAt"`
}

func initWatchedTables() {
	db.Exec(`CREATE TABLE IF NOT EXISTS watched_playlists (
		id TEXT PRIMARY KEY,
		url TEXT NOT NULL,
		name TEXT NOT NULL DEFAULT '',
		track_count INTEGER NOT NULL DEFAULT 0,
		last_refresh TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS watched_playlist_tracks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		playlist_id TEXT NOT NULL,
		artist TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		job_id TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		FOREIGN KEY (playlist_id) REFERENCES watched_playlists(id)
	)`)
}

func dbGetWatchedPlaylists() ([]WatchedPlaylist, error) {
	rows, err := db.Query(`SELECT id, url, name, track_count, last_refresh, created_at FROM watched_playlists ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []WatchedPlaylist
	for rows.Next() {
		var p WatchedPlaylist
		if rows.Scan(&p.ID, &p.URL, &p.Name, &p.TrackCount, &p.LastRefresh, &p.CreatedAt) == nil {
			result = append(result, p)
		}
	}
	return result, nil
}

func extractYouTubePlaylistTracks(playlistURL string) (string, [][2]string, error) {
	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		return "", nil, fmt.Errorf("yt-dlp not found")
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		"--playlist-end", "500",
		playlistURL,
	)
	output, err := cmd.Output()
	if err != nil {
		return "", nil, err
	}

	var tracks [][2]string
	playlistName := ""
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry struct {
			Title        string `json:"title"`
			Channel      string `json:"channel"`
			Uploader     string `json:"uploader"`
			PlaylistTitle string `json:"playlist_title"`
		}
		if json.Unmarshal([]byte(line), &entry) != nil {
			continue
		}
		if playlistName == "" && entry.PlaylistTitle != "" {
			playlistName = entry.PlaylistTitle
		}
		if entry.Title == "" {
			continue
		}

		artist := entry.Uploader
		if artist == "" {
			artist = entry.Channel
		}
		if artist == "" {
			artist = "Unknown Artist"
		}
		title := entry.Title

		if idx := strings.Index(title, " - "); idx > 0 && artist == entry.Uploader {
			possibleArtist := strings.TrimSpace(title[:idx])
			possibleTitle := strings.TrimSpace(title[idx+3:])
			if possibleArtist != "" && possibleTitle != "" {
				artist = possibleArtist
				title = possibleTitle
			}
		}

		tracks = append(tracks, [2]string{artist, title})
	}

	if playlistName == "" {
		playlistName = "Playlist"
	}

	return playlistName, tracks, nil
}

var (
	watchMu     sync.Mutex
	watchActive bool
)

func startWatchScheduler() {
	go func() {
		for {
			time.Sleep(1 * time.Hour)
			refreshAllWatchedPlaylists()
		}
	}()
}

func refreshAllWatchedPlaylists() {
	watchMu.Lock()
	if watchActive {
		watchMu.Unlock()
		return
	}
	watchActive = true
	watchMu.Unlock()

	defer func() {
		watchMu.Lock()
		watchActive = false
		watchMu.Unlock()
	}()

	playlists, err := dbGetWatchedPlaylists()
	if err != nil || len(playlists) == 0 {
		return
	}

	for _, p := range playlists {
		if err := refreshWatchedPlaylist(&p); err != nil {
			log.Printf("[watched] Failed to refresh %s: %v", p.Name, err)
		}
		time.Sleep(30 * time.Second)
	}
}

func refreshWatchedPlaylist(p *WatchedPlaylist) error {
	name, tracksFromYT, err := extractYouTubePlaylistTracks(p.URL)
	if err != nil {
		return err
	}

	if name != "" && name != p.Name {
		db.Exec("UPDATE watched_playlists SET name = ? WHERE id = ?", name, p.ID)
	}

	existingTracks := map[string]bool{}
	rows, err := db.Query("SELECT artist, title FROM watched_playlist_tracks WHERE playlist_id = ?", p.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var artist, title string
			if rows.Scan(&artist, &title) == nil {
				existingTracks[strings.ToLower(artist+"|"+title)] = true
			}
		}
	}

	newCount := 0
	for _, t := range tracksFromYT {
		artist, title := t[0], t[1]
		key := strings.ToLower(artist + "|" + title)
		if existingTracks[key] {
			continue
		}

		mu.RLock()
		inLib := false
		for _, tr := range tracks {
			if strings.EqualFold(tr.Artist, artist) && strings.EqualFold(tr.Title, title) {
				inLib = true
				break
			}
		}
		mu.RUnlock()
		if inLib {
			db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, artist, title, status) VALUES (?, ?, ?, 'completed')", p.ID, artist, title)
			continue
		}

		createDownloadJob("", artist, title, "", "", 0, 0, "")
		db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, artist, title, status) VALUES (?, ?, ?, 'queued')", p.ID, artist, title)
		newCount++
	}

	totalCount := len(existingTracks) + newCount
	now := time.Now().Format(time.RFC3339)
	db.Exec("UPDATE watched_playlists SET track_count = ?, last_refresh = ? WHERE id = ?", totalCount, now, p.ID)

	log.Printf("[watched] Playlist %q: %d total, %d new", p.Name, totalCount, newCount)
	return nil
}
