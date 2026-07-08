package handlers

import (
	"encoding/json"
	"musicapp/internal/auth"
	"musicapp/internal/store"
	"net/http"
	"strings"
)

func PlaylistsHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
	switch r.Method {
	case http.MethodGet:
		playlists := store.DbGetPlaylists(u.ID)
		writeJSON(w, playlists)

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

		playlist := store.DbCreatePlaylist(u.ID, body.Name)

		writeJSON(w, playlist)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func PlaylistHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
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

		store.DbUpdatePlaylist(u.ID, id, body.Name, body.TrackIDs)

		playlists := store.DbGetPlaylists(u.ID)
		for _, p := range playlists {
			if p.ID == id {
				writeJSON(w, p)
				return
			}
		}
		http.Error(w, "Playlist not found", http.StatusNotFound)

	case http.MethodDelete:
		if !store.DbDeletePlaylist(u.ID, id) {
			http.Error(w, "Playlist not found", http.StatusNotFound)
			return
		}

		writeJSON(w, map[string]bool{"deleted": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func FavoritesHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
	favorites := store.DbGetUserFavorites(u.ID)
	writeJSON(w, favorites)
}

func FavoriteToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	u := auth.CurrentUser(r)
	trackID := strings.TrimPrefix(r.URL.Path, "/api/favorites/")
	if trackID == "" {
		http.Error(w, "missing track id", http.StatusBadRequest)
		return
	}
	added := store.DbToggleUserFavorite(u.ID, trackID)
	writeJSON(w, map[string]bool{"added": added})
}

func RecentHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
	recent := store.DbGetUserRecent(u.ID)
	writeJSON(w, recent)
}

func RecentAddHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
	trackID := strings.TrimPrefix(r.URL.Path, "/api/recent/")
	if trackID == "" {
		http.Error(w, "missing track id", http.StatusBadRequest)
		return
	}
	if err := store.DbAddUserRecent(u.ID, trackID); err != nil {
		http.Error(w, "add recent: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"added": true})
}

func SharedQueueCreateHandler(w http.ResponseWriter, r *http.Request) {
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
	id := store.DbSaveSharedQueue(string(trackJSON))
	writeJSON(w, map[string]string{"id": id})
}

func SharedQueueGetHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/shared-queue/")
	if id == "" {
		http.Error(w, "Missing queue id", http.StatusBadRequest)
		return
	}
	ids, err := store.DbGetSharedQueue(id)
	if err != nil {
		http.Error(w, "Queue not found", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string][]string{"trackIds": ids})
}
