package main

import (
	"bytes"
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
		video_id TEXT NOT NULL DEFAULT '',
		artist TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		job_id TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		FOREIGN KEY (playlist_id) REFERENCES watched_playlists(id)
	)`)
	db.Exec(`ALTER TABLE watched_playlist_tracks ADD COLUMN video_id TEXT NOT NULL DEFAULT ''`)
}

func syncWatchedPlaylistsToLibrary() {
	playlists, err := dbGetWatchedPlaylists()
	if err != nil || len(playlists) == 0 {
		return
	}

	mu.RLock()
	libTracks := make(map[string]string)
	for _, t := range tracks {
		key := strings.ToLower(t.Artist + "|" + t.Title)
		libTracks[key] = t.ID
	}
	mu.RUnlock()

	for _, wp := range playlists {
		libraryPlaylistID := dbGetOrCreatePlaylistByName(wp.Name)

		rows, err := db.Query("SELECT artist, title FROM watched_playlist_tracks WHERE playlist_id = ? AND status = 'completed'", wp.ID)
		if err != nil {
			continue
		}
		added := 0
		for rows.Next() {
			var artist, title string
			if rows.Scan(&artist, &title) != nil {
				continue
			}
			key := strings.ToLower(artist + "|" + title)
			if trackID, ok := libTracks[key]; ok {
				dbAddTrackToPlaylist(libraryPlaylistID, trackID)
				added++
			}
		}
		rows.Close()
		if added > 0 {
			log.Printf("[watched] Synced %d tracks from %q to library playlist", added, wp.Name)
		}
	}
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

type PlaylistTrackInfo struct {
	VideoID string
	Artist  string
	Title   string
}

func extractYouTubePlaylistTracks(playlistURL string) (string, []PlaylistTrackInfo, error) {
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
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return "", nil, fmt.Errorf("yt-dlp: %s: %s", err.Error(), strings.TrimSpace(stderr.String()))
	}

	var result []PlaylistTrackInfo
	playlistName := ""
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry struct {
			ID            string `json:"id"`
			Title         string `json:"title"`
			Channel       string `json:"channel"`
			Uploader      string `json:"uploader"`
			Creator       string `json:"creator"`
			Artist        string `json:"artist"`
			AlbumArtist   string `json:"album_artist"`
			PlaylistTitle string `json:"playlist_title"`
			Duration      float64 `json:"duration"`
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

		artist := ""
		title := entry.Title

		for _, sep := range []string{" - ", " – ", " | ", " — "} {
			if idx := strings.Index(title, sep); idx > 0 {
				possibleArtist := strings.TrimSpace(title[:idx])
				possibleTitle := strings.TrimSpace(title[idx+len(sep):])
				if possibleArtist != "" && possibleTitle != "" {
					artist = possibleArtist
					title = possibleTitle
					break
				}
			}
		}

		if artist == "" {
			artist = entry.Artist
		}
		if artist == "" {
			artist = entry.AlbumArtist
		}
		if artist == "" {
			artist = entry.Creator
		}
		if artist == "" {
			artist = entry.Uploader
		}
		if artist == "" {
			artist = entry.Channel
		}

		artist = strings.TrimSuffix(artist, " - Topic")
		artist = strings.TrimSuffix(artist, " Topic")
		artist = strings.TrimSuffix(artist, "VEVO")
		artist = strings.TrimSpace(artist)

		if artist == "" {
			artist = "Unknown"
		}

		title = strings.TrimPrefix(title, "\"")
		title = strings.TrimSuffix(title, "\"")
		title = strings.TrimPrefix(title, "'")
		title = strings.TrimSuffix(title, "'")
		title = strings.TrimSpace(title)
		title = strings.TrimSuffix(title, " (Official Audio)")
		title = strings.TrimSuffix(title, " (Official Music Video)")
		title = strings.TrimSuffix(title, " (Official Video)")
		title = strings.TrimSuffix(title, " [Official Audio]")
		title = strings.TrimSuffix(title, " [Official Video]")
		title = strings.TrimSpace(title)

		result = append(result, PlaylistTrackInfo{
			VideoID: entry.ID,
			Artist:  artist,
			Title:   title,
		})
	}

	if playlistName == "" {
		playlistName = "Playlist"
	}
	playlistName = strings.TrimPrefix(playlistName, "Album - ")
	playlistName = strings.TrimPrefix(playlistName, "Single - ")
	playlistName = strings.TrimPrefix(playlistName, "EP - ")
	playlistName = strings.TrimSpace(playlistName)

	return playlistName, result, nil
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
	rows, err := db.Query("SELECT video_id, artist, title FROM watched_playlist_tracks WHERE playlist_id = ?", p.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var videoID, artist, title string
			if rows.Scan(&videoID, &artist, &title) == nil {
				key := strings.ToLower(artist + "|" + title)
				if videoID != "" {
					key = "vid:" + videoID
				}
				existingTracks[key] = true
			}
		}
	}

	libraryPlaylistID := dbGetOrCreatePlaylistByName(p.Name)

	newCount := 0
	for _, t := range tracksFromYT {
		artist, title, videoID := t.Artist, t.Title, t.VideoID
		key := strings.ToLower(artist + "|" + title)
		if videoID != "" {
			key = "vid:" + videoID
		}
		if existingTracks[key] {
			continue
		}

		mu.RLock()
		inLib := false
		var libTrackID string
		for _, tr := range tracks {
			if strings.EqualFold(tr.Artist, artist) && strings.EqualFold(tr.Title, title) {
				inLib = true
				libTrackID = tr.ID
				break
			}
		}
		mu.RUnlock()
		if inLib {
			if libTrackID != "" {
				dbAddTrackToPlaylist(libraryPlaylistID, libTrackID)
			}
			db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, video_id, artist, title, status) VALUES (?, ?, ?, ?, 'completed')", p.ID, videoID, artist, title)
			continue
		}

		job, _ := createDownloadJob("", artist, title, "", "", 0, 0, "", videoID)
		if job != nil {
			job.PlaylistID = libraryPlaylistID
			db.Exec("UPDATE download_jobs SET playlist_id = ? WHERE id = ?", libraryPlaylistID, job.ID)
		}
		db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, video_id, artist, title, status) VALUES (?, ?, ?, ?, 'queued')", p.ID, videoID, artist, title)
		newCount++
	}

	totalCount := len(existingTracks) + newCount
	now := time.Now().Format(time.RFC3339)
	db.Exec("UPDATE watched_playlists SET track_count = ?, last_refresh = ? WHERE id = ?", totalCount, now, p.ID)

	log.Printf("[watched] Playlist %q: %d total, %d new", p.Name, totalCount, newCount)
	return nil
}
