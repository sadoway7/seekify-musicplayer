package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"sync/atomic"
)

// libraryVersion is incremented whenever the library changes (scan, watcher, metadata update).
var libraryVersion atomic.Int64

func statsHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	trackCount := len(tracks)
	albumCount := len(albums)
	mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks":   trackCount,
		"albums":   albumCount,
		"version":  libraryVersion.Load(),
	})
}

func libraryHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()

	reviewStatuses := dbLoadAllReviewStatuses()

	trackList := make([]Track, 0, len(tracks))
	for _, t := range tracks {
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

	albumList := make([]Album, 0, len(albums))
	for _, a := range albums {
		albumList = append(albumList, *a)
	}
	sort.Slice(albumList, func(i, j int) bool {
		return albumList[i].Name < albumList[j].Name
	})

	artistMap := make(map[string]*Artist)
	for _, t := range tracks {
		name := t.Artist
		if _, exists := artistMap[name]; !exists {
			artistMap[name] = &Artist{Name: name}
		}
		artistMap[name].TrackCount++
	}
	for _, a := range albums {
		name := a.Artist
		if _, exists := artistMap[name]; exists {
			artistMap[name].AlbumCount++
		}
	}

	artistList := make([]Artist, 0, len(artistMap))
	for _, a := range artistMap {
		artistList = append(artistList, *a)
	}
	sort.Slice(artistList, func(i, j int) bool {
		return artistList[i].Name < artistList[j].Name
	})

	resp := LibraryResponse{
		Tracks:  trackList,
		Albums:  albumList,
		Artists: artistList,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
