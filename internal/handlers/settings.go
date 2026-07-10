package handlers

import (
	"encoding/json"
	"log"
	"musicapp/internal/auth"
	"musicapp/internal/downloads"
	"musicapp/internal/store"
	"musicapp/internal/watched"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

func SettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, store.GetAllSettings())
}

// PublicSettingsHandler returns only the non-sensitive global display settings
// that every client needs to render the site (waveform style, downloads flag).
// No auth: the admin sets these to configure the site's look/behavior for all
// visitors; sensitive admin config (download source, credentials) stays behind
// the admin-only /api/settings, and writes stay admin-only.
func PublicSettingsHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"waveform_style":           store.GetSetting("waveform_style", "rounded"),
		"downloads_enabled":        store.GetSetting("downloads_enabled", "true"),
		"default_now_playing_view": store.GetSetting("default_now_playing_view", "visualizer"),
	})
}

func SettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	for k, v := range settings {
		store.SetSetting(k, v)
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

func BulkImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Lines       string `json:"lines"`
		OverrideDir string `json:"overrideDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	var jobs []string
	for _, line := range strings.Split(req.Lines, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		artist, title := "", line
		if idx := strings.Index(line, " - "); idx > 0 {
			artist = strings.TrimSpace(line[:idx])
			title = strings.TrimSpace(line[idx+3:])
		}

		job, err := downloads.CreateDownloadJob(auth.CurrentUser(r).ID, "", artist, title, "", "", 0, 0, req.OverrideDir, "")
		if err != nil {
			log.Printf("[bulk] Skipped %q: %v", line, err)
			continue
		}
		jobs = append(jobs, job.ID)
		time.Sleep(100 * time.Millisecond)
	}

	writeJSON(w, map[string]interface{}{"queued": len(jobs), "ids": jobs})
}

func PlaylistImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
		return
	}

	name, ytTracks, err := watched.ExtractYouTubePlaylistTracks(req.URL)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	libraryPlaylistID := store.DbGetOrCreatePlaylistByName(name)

	wp := &watched.WatchedPlaylist{
		ID:        uuid.New().String()[:8],
		URL:       req.URL,
		Name:      name,
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	store.DB.Exec(`INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		wp.ID, wp.URL, wp.Name, wp.TrackCount, wp.CreatedAt, wp.CreatedAt)

	queued := 0
	for _, t := range ytTracks {
		artist, title, videoID := t.Artist, t.Title, t.VideoID
		inLib := checkDuplicateInLibrary(artist, title)

		status := "pending"
		if inLib {
			status = "completed"
			store.Mu.RLock()
			for _, tr := range store.Tracks {
				if strings.EqualFold(tr.Artist, artist) && strings.EqualFold(tr.Title, title) {
					store.DbAddTrackToPlaylist(libraryPlaylistID, tr.ID)
					break
				}
			}
			store.Mu.RUnlock()
		}

		store.DB.Exec("INSERT INTO watched_playlist_tracks (playlist_id, video_id, artist, title, status) VALUES (?, ?, ?, ?, ?)",
			wp.ID, videoID, artist, title, status)

		if !inLib {
			job, _ := downloads.CreateDownloadJob(auth.CurrentUser(r).ID, "", artist, title, "", "", 0, 0, "", videoID)
			if job != nil {
				job.PlaylistID = libraryPlaylistID
				store.DB.Exec("UPDATE download_jobs SET playlist_id = ? WHERE id = ?", libraryPlaylistID, job.ID)
			}
			queued++
			time.Sleep(100 * time.Millisecond)
		}
	}

	writeJSON(w, map[string]interface{}{
		"id":        wp.ID,
		"name":      name,
		"total":     len(ytTracks),
		"queued":    queued,
		"inLibrary": len(ytTracks) - queued,
	})
}

func WatchedPlaylistsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
			return
		}

		name, _, err := watched.ExtractYouTubePlaylistTracks(req.URL)
		if err != nil {
			http.Error(w, `{"error":"could not fetch playlist"}`, http.StatusBadRequest)
			return
		}

		wp := &watched.WatchedPlaylist{
			ID:        uuid.New().String()[:8],
			URL:       req.URL,
			Name:      name,
			CreatedAt: time.Now().Format(time.RFC3339),
		}
		store.DB.Exec("INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, 0, ?, ?)",
			wp.ID, wp.URL, wp.Name, wp.CreatedAt, wp.CreatedAt)

		store.SafeGo("watched-refresh", func() { watched.RefreshWatchedPlaylist(wp) })

		writeJSON(w, map[string]interface{}{
			"id":         wp.ID,
			"name":       name,
			"url":        wp.URL,
			"total":      0,
			"queued":     0,
			"trackCount": 0,
		})
		return
	}

	if strings.HasSuffix(r.URL.Path, "/toggle") && r.Method == "PUT" {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		id = strings.TrimSuffix(id, "/toggle")
		var req struct {
			Watching bool `json:"watching"`
		}
		if json.NewDecoder(r.Body).Decode(&req) == nil && id != "" {
			watching := 0
			if req.Watching {
				watching = 1
			}
			store.DB.Exec("UPDATE watched_playlists SET watching = ? WHERE id = ?", watching, id)
		}
		writeJSON(w, map[string]string{"status": "ok"})
		return
	}

	if strings.HasSuffix(r.URL.Path, "/refresh") {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		id = strings.TrimSuffix(id, "/refresh")
		if id != "" {
			var wp watched.WatchedPlaylist
			var watching int
			row := store.DB.QueryRow("SELECT id, url, name, track_count, last_refresh, watching, created_at FROM watched_playlists WHERE id = ?", id)
			row.Scan(&wp.ID, &wp.URL, &wp.Name, &wp.TrackCount, &wp.LastRefresh, &watching, &wp.CreatedAt)
			wp.Watching = watching == 1
			if wp.ID != "" {
				store.SafeGo("watched-refresh", func() { watched.RefreshWatchedPlaylist(&wp) })
			}
		}
		writeJSON(w, map[string]string{"status": "ok"})
		return
	}

	if r.Method == "DELETE" {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		store.DB.Exec("DELETE FROM watched_playlist_tracks WHERE playlist_id = ?", id)
		store.DB.Exec("DELETE FROM watched_playlists WHERE id = ?", id)
		writeJSON(w, map[string]string{"status": "ok"})
		return
	}

	playlists, err := watched.DbGetWatchedPlaylists()
	if err != nil {
		playlists = []watched.WatchedPlaylist{}
	}
	writeJSON(w, playlists)
}
