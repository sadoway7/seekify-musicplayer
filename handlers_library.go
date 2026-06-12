package main

import (
	"encoding/json"
	"musicapp/internal/models"
	"musicapp/internal/store"
	"net/http"
	"sort"
	"sync/atomic"
)

// libraryVersion is incremented whenever the library changes (scan, watcher, metadata update).
var libraryVersion atomic.Int64

func statsHandler(w http.ResponseWriter, r *http.Request) {
	store.Mu.RLock()
	trackCount := len(store.Tracks)
	albumCount := len(store.Albums)
	store.Mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks":   trackCount,
		"albums":   albumCount,
		"version":  libraryVersion.Load(),
	})
}

func libraryHandler(w http.ResponseWriter, r *http.Request) {
	store.Mu.RLock()
	defer store.Mu.RUnlock()

	reviewStatuses := dbLoadAllReviewStatuses()

	trackList := make([]models.Track, 0, len(store.Tracks))
	for _, t := range store.Tracks {
		copy := *t
		if rs, ok := reviewStatuses[t.ID]; ok {
			copy.ReviewStatus = rs.Status
			copy.ReviewFlags = rs.Flags
		}
		trackList = append(trackList, copy)
	}
	sort.Slice(trackList, func(i, j int) bool {
		return trackList[i].Title < trackList[j].Title
	})

	albumList := make([]models.Album, 0, len(store.Albums))
	for _, a := range store.Albums {
		albumList = append(albumList, *a)
	}
	sort.Slice(albumList, func(i, j int) bool {
		return albumList[i].Name < albumList[j].Name
	})

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

	artistList := make([]models.Artist, 0, len(artistMap))
	for _, a := range artistMap {
		artistList = append(artistList, *a)
	}
	sort.Slice(artistList, func(i, j int) bool {
		return artistList[i].Name < artistList[j].Name
	})

	resp := models.LibraryResponse{
		Tracks:  trackList,
		Albums:  albumList,
		Artists: artistList,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
