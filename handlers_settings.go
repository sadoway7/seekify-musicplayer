package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

func settingsGetHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getAllSettings())
}

func settingsSetHandler(w http.ResponseWriter, r *http.Request) {
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
		setSetting(k, v)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func bulkImportHandler(w http.ResponseWriter, r *http.Request) {
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

		job, err := createDownloadJob("", artist, title, "", "", 0, 0, req.OverrideDir, "")
		if err != nil {
			log.Printf("[bulk] Skipped %q: %v", line, err)
			continue
		}
		jobs = append(jobs, job.ID)
		time.Sleep(100 * time.Millisecond)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"queued": len(jobs), "ids": jobs})
}

func playlistImportHandler(w http.ResponseWriter, r *http.Request) {
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

	name, ytTracks, err := extractYouTubePlaylistTracks(req.URL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	libraryPlaylistID := dbGetOrCreatePlaylistByName(name)

	wp := &WatchedPlaylist{
		ID:        uuid.New().String()[:8],
		URL:       req.URL,
		Name:      name,
		TrackCount: len(ytTracks),
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	db.Exec(`INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		wp.ID, wp.URL, wp.Name, wp.TrackCount, wp.CreatedAt, wp.CreatedAt)

	queued := 0
	for _, t := range ytTracks {
		artist, title, videoID := t.Artist, t.Title, t.VideoID
		inLib := checkDuplicateInLibrary(artist, title)

		status := "pending"
		if inLib {
			status = "completed"
			mu.RLock()
			for _, tr := range tracks {
				if strings.EqualFold(tr.Artist, artist) && strings.EqualFold(tr.Title, title) {
					dbAddTrackToPlaylist(libraryPlaylistID, tr.ID)
					break
				}
			}
			mu.RUnlock()
		}

		db.Exec("INSERT INTO watched_playlist_tracks (playlist_id, video_id, artist, title, status) VALUES (?, ?, ?, ?, ?)",
			wp.ID, videoID, artist, title, status)

		if !inLib {
			job, _ := createDownloadJob("", artist, title, "", "", 0, 0, "", videoID)
			if job != nil {
				job.PlaylistID = libraryPlaylistID
				db.Exec("UPDATE download_jobs SET playlist_id = ? WHERE id = ?", libraryPlaylistID, job.ID)
			}
			queued++
			time.Sleep(100 * time.Millisecond)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":        wp.ID,
		"name":      name,
		"total":     len(ytTracks),
		"queued":    queued,
		"inLibrary": len(ytTracks) - queued,
	})
}

func watchedPlaylistsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
			return
		}

		name, _, err := extractYouTubePlaylistTracks(req.URL)
		if err != nil {
			http.Error(w, `{"error":"could not fetch playlist"}`, http.StatusBadRequest)
			return
		}

		wp := &WatchedPlaylist{
			ID:        uuid.New().String()[:8],
			URL:       req.URL,
			Name:      name,
			CreatedAt: time.Now().Format(time.RFC3339),
		}
		db.Exec("INSERT INTO watched_playlists (id, url, name, track_count, last_refresh, created_at) VALUES (?, ?, ?, 0, ?, ?)",
			wp.ID, wp.URL, wp.Name, wp.CreatedAt, wp.CreatedAt)

		go refreshWatchedPlaylist(wp)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":        wp.ID,
			"name":      name,
			"url":       wp.URL,
			"total":     0,
			"queued":    0,
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
			db.Exec("UPDATE watched_playlists SET watching = ? WHERE id = ?", watching, id)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	if strings.HasSuffix(r.URL.Path, "/refresh") {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		id = strings.TrimSuffix(id, "/refresh")
		if id != "" {
			var wp WatchedPlaylist
			var watching int
			row := db.QueryRow("SELECT id, url, name, track_count, last_refresh, watching, created_at FROM watched_playlists WHERE id = ?", id)
			row.Scan(&wp.ID, &wp.URL, &wp.Name, &wp.TrackCount, &wp.LastRefresh, &watching, &wp.CreatedAt)
			wp.Watching = watching == 1
			if wp.ID != "" {
				go refreshWatchedPlaylist(&wp)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	if r.Method == "DELETE" {
		id := strings.TrimPrefix(r.URL.Path, "/api/watch/")
		db.Exec("DELETE FROM watched_playlist_tracks WHERE playlist_id = ?", id)
		db.Exec("DELETE FROM watched_playlists WHERE id = ?", id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	playlists, err := dbGetWatchedPlaylists()
	if err != nil {
		playlists = []WatchedPlaylist{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(playlists)
}
