package handlers

import (
	"encoding/json"
	"musicapp/internal/models"
	"musicapp/internal/review"
	"musicapp/internal/store"
	"net/http"
	"sort"
	"strconv"
	"sync/atomic"
)

// LibraryVersion is incremented whenever the library changes (scan, watcher, metadata update).
var LibraryVersion atomic.Int64

func StatsHandler(w http.ResponseWriter, r *http.Request) {
	store.Mu.RLock()
	trackCount := len(store.Tracks)
	albumCount := len(store.Albums)
	store.Mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks":  trackCount,
		"albums":  albumCount,
		"version": LibraryVersion.Load(),
	})
}

func LibraryHandler(w http.ResponseWriter, r *http.Request) {
	// Review statuses live in their own DB table; no map lock needed to read them.
	reviewStatuses := review.DbLoadAllReviewStatuses()

	// Snapshot the maps under the read lock; sort and encode after release so a
	// slow client draining the response cannot block writers.
	store.Mu.RLock()
	trackList := make([]models.Track, 0, len(store.Tracks))
	for _, t := range store.Tracks {
		copy := *t
		if rs, ok := reviewStatuses[t.ID]; ok {
			copy.ReviewStatus = rs.Status
			copy.ReviewFlags = rs.Flags
		}
		trackList = append(trackList, copy)
	}

	albumList := make([]models.Album, 0, len(store.Albums))
	for _, a := range store.Albums {
		albumList = append(albumList, *a)
	}

	artistMap := make(map[string]*models.Artist)
	for _, t := range store.Tracks {
		name := t.Artist
		if _, exists := artistMap[name]; !exists {
			artistMap[name] = &models.Artist{Name: name}
		}
		artistMap[name].TrackCount++
	}
	for _, a := range store.Albums {
		name := a.Artist
		if _, exists := artistMap[name]; exists {
			artistMap[name].AlbumCount++
		}
	}
	store.Mu.RUnlock()

	sort.Slice(trackList, func(i, j int) bool { return trackList[i].Title < trackList[j].Title })
	sort.Slice(albumList, func(i, j int) bool { return albumList[i].Name < albumList[j].Name })

	artistList := make([]models.Artist, 0, len(artistMap))
	for _, a := range artistMap {
		artistList = append(artistList, *a)
	}
	sort.Slice(artistList, func(i, j int) bool {
		return artistList[i].Name < artistList[j].Name
	})

	offset, hasOffset := 0, false
	limit, hasLimit := 0, false
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
		hasOffset = true
	}
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
		hasLimit = true
	}

	resp := models.LibraryResponse{
		Tracks:  trackList,
		Albums:  albumList,
		Artists: artistList,
		Version: LibraryVersion.Load(),
	}

	if hasOffset || hasLimit {
		if !hasLimit {
			limit = 100
		}
		resp.TotalTracks = len(trackList)
		resp.TotalAlbums = len(albumList)
		resp.TotalArtists = len(artistList)
		if offset < len(trackList) {
			end := offset + limit
			if end > len(trackList) {
				end = len(trackList)
			}
			resp.Tracks = trackList[offset:end]
		} else {
			resp.Tracks = []models.Track{}
		}
		if offset < len(albumList) {
			end := offset + limit
			if end > len(albumList) {
				end = len(albumList)
			}
			resp.Albums = albumList[offset:end]
		} else {
			resp.Albums = []models.Album{}
		}
		if offset < len(artistList) {
			end := offset + limit
			if end > len(artistList) {
				end = len(artistList)
			}
			resp.Artists = artistList[offset:end]
		} else {
			resp.Artists = []models.Artist{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
