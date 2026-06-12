package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func playlistsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		playlists := dbGetPlaylists()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(playlists)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if body.Name == "" {
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		playlist := dbCreatePlaylist(body.Name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(playlist)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func playlistHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/playlists/")

	switch r.Method {
	case http.MethodPut:
		var body struct {
			Name     string   `json:"name"`
			TrackIDs []string `json:"trackIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		dbUpdatePlaylist(id, body.Name, body.TrackIDs)

		w.Header().Set("Content-Type", "application/json")
		playlists := dbGetPlaylists()
		for _, p := range playlists {
			if p.ID == id {
				json.NewEncoder(w).Encode(p)
				return
			}
		}
		http.Error(w, "Playlist not found", http.StatusNotFound)

	case http.MethodDelete:
		if !dbDeletePlaylist(id) {
			http.Error(w, "Playlist not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"deleted": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func favoritesHandler(w http.ResponseWriter, r *http.Request) {
	favorites := dbGetFavorites()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(favorites)
}

func favoriteToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimPrefix(r.URL.Path, "/api/favorites/")
	if trackID == "" {
		http.Error(w, "missing track id", http.StatusBadRequest)
		return
	}
	added := dbToggleFavorite(trackID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"added": added})
}

func recentHandler(w http.ResponseWriter, r *http.Request) {
	recent := dbGetRecent()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(recent)
}

func recentAddHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/recent/")
	dbAddRecent(trackID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"added": true})
}

func sharedQueueCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		TrackIDs []string `json:"trackIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.TrackIDs) == 0 {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	trackJSON, _ := json.Marshal(body.TrackIDs)
	id := dbSaveSharedQueue(string(trackJSON))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func sharedQueueGetHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/shared-queue/")
	if id == "" {
		http.Error(w, "Missing queue id", http.StatusBadRequest)
		return
	}
	ids, err := dbGetSharedQueue(id)
	if err != nil {
		http.Error(w, "Queue not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"trackIds": ids})
}
