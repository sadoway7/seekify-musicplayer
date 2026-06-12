package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func metadataScanHandler(w http.ResponseWriter, r *http.Request) {
	metaScanLock.Lock()
	if metaScan.Running {
		metaScanLock.Unlock()
		http.Error(w, "Scan already in progress", http.StatusConflict)
		return
	}
	metaScanLock.Unlock()

	go scanMetadataForTracks()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "started",
	})
}

func metadataRescanHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	mu.RLock()
	track, exists := tracks[trackID]
	mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	db.Exec("DELETE FROM metadata_matches WHERE track_id = ?", trackID)

	go func() {
		searchTitle := track.Title
		searchArtist := track.Artist
		if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(titleFromFilename(track.FilePath)) {
			searchTitle = titleFromFilename(track.FilePath)
		}
		log.Printf("[metadata] Rescanning single track: %s - %s", searchArtist, searchTitle)

		candidates, err := mbSearchRecordings(searchArtist, searchTitle, 10)
		if err != nil {
			log.Printf("[metadata] Rescan failed for %q - %q: %v", searchArtist, searchTitle, err)
			return
		}

		inserted := 0
		for _, cand := range candidates {
			score := scoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)
			if score < 0.5 {
				continue
			}

			mu.RLock()
			hasCover := false
			if cand.AlbumID != "" {
				coverPath := filepath.Join(musicDir, "images", cand.AlbumID+".jpg")
				if _, err := os.Stat(coverPath); err == nil {
					hasCover = true
				}
			}
			mu.RUnlock()

			match := &MetadataMatch{
				ID:          generateUUID(),
				TrackID:     trackID,
				TrackTitle:  searchTitle,
				TrackArtist: searchArtist,
				MBTitle:     cand.Title,
				MBArtist:    cand.Artist,
				MBAlbum:     cand.Album,
				MBAlbumID:   cand.AlbumID,
				MBScore:     score,
				Status:      "pending",
				HasCover:    hasCover,
				FilePath:    track.FilePath,
			}
			dbInsertMetadataMatch(match)
			inserted++
		}
		log.Printf("[metadata] Rescan complete: %d candidates found for %s - %s", inserted, searchArtist, searchTitle)
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "started",
	})
}

func metadataRescanSyncHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan-sync/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	mu.RLock()
	track, exists := tracks[trackID]
	mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	searchTitle := track.Title
	searchArtist := track.Artist
	if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(titleFromFilename(track.FilePath)) {
		searchTitle = titleFromFilename(track.FilePath)
	}

	candidates, err := mbSearchRecordings(searchArtist, searchTitle, 50)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	type rescanCandidate struct {
		Title    string  `json:"title"`
		Artist   string  `json:"artist"`
		Album    string  `json:"album"`
		AlbumID  string  `json:"albumId"`
		Score    float64 `json:"score"`
		HasCover bool    `json:"hasCover"`
	}

	var results []rescanCandidate
	for _, cand := range candidates {
		score := scoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)

		mu.RLock()
		hasCover := false
		if cand.AlbumID != "" {
			coverPath := filepath.Join(musicDir, "images", cand.AlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				hasCover = true
			}
		}
		mu.RUnlock()

		results = append(results, rescanCandidate{
			Title:    cand.Title,
			Artist:   cand.Artist,
			Album:    cand.Album,
			AlbumID:  cand.AlbumID,
			Score:    score,
			HasCover: hasCover,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func cleanRescanTitle(title string) string {
	title = strings.TrimSpace(title)
	re := strings.NewReplacer(
		"[Official Music Video]", "",
		"[Official Video]", "",
		"[Official Visualizer]", "",
		"[Official Lyric Video]", "",
		"[Official Lyric Visualizer]", "",
		"[Official Audio]", "",
		"[Official Visualiser]", "",
		"[Official]", "",
		"[OFFICIAL]", "",
		"[HD]", "",
		"[HD UPGRADE]", "",
		"[4K Upgrade]", "",
		"[4K]", "",
		"(Official Music Video)", "",
		"(Official Video)", "",
		"(Official Visualizer)", "",
		"(Official Lyric Video)", "",
		"(Official Lyric Visualizer)", "",
		"(Official Audio)", "",
		"(Official Visualiser)", "",
		"(Official)", "",
		"(OFFICIAL)", "",
		"(Music Video)", "",
		"(Lyric Video)", "",
		"(Visualizer)", "",
		"(Visualiser)", "",
		"(Audio)", "",
		"(HD)", "",
		"(4K)", "",
		"(Lyric Visualizer)", "",
		"(Official HD Video)", "",
		"(Official 4K Music Video)", "",
		"(Official HD Music Video)", "",
		"(Official 4K Video)", "",
		"(Official Remastered HD Video)", "",
		"(Official HD Remastered Video)", "",
	)
	title = re.Replace(title)
	for {
		start := strings.Index(title, "[")
		end := strings.Index(title, "]")
		if start == -1 || end == -1 || end <= start {
			break
		}
		bracket := title[start : end+1]
		lower := strings.ToLower(bracket)
		if strings.Contains(lower, "official") || strings.Contains(lower, "video") || strings.Contains(lower, "visualiz") || strings.Contains(lower, "lyric") || strings.Contains(lower, "audio") || strings.Contains(lower, "hd") || strings.Contains(lower, "4k") || strings.Contains(lower, "upgrade") || strings.Contains(lower, "remaster") {
			title = strings.TrimSpace(title[:start] + title[end+1:])
			continue
		}
		break
	}
	title = strings.TrimSpace(title)
	return title
}

func cleanRescanArtist(artist string) string {
	artist = strings.TrimSpace(artist)
	artist = strings.TrimSuffix(artist, " - Topic")
	artist = strings.TrimSuffix(artist, "VEVO")
	artist = strings.TrimSuffix(artist, "Official")
	artist = strings.TrimSuffix(artist, "OfficialMusic")
	artist = strings.TrimSuffix(artist, "TV")
	artist = strings.TrimSpace(artist)
	return artist
}

func metadataSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	parts := strings.SplitN(q, " - ", 2)
	searchArtist := ""
	searchTitle := q
	if len(parts) == 2 {
		searchArtist = strings.TrimSpace(parts[0])
		searchTitle = strings.TrimSpace(parts[1])
	}

	searchTitle = cleanRescanTitle(searchTitle)
	searchArtist = cleanRescanArtist(searchArtist)

	candidates, err := mbSearchRecordings(searchArtist, searchTitle, 50)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	type rescanCandidate struct {
		Title   string  `json:"title"`
		Artist  string  `json:"artist"`
		Album   string  `json:"album"`
		AlbumID string  `json:"albumId"`
		Score   float64 `json:"score"`
	}

	var results []rescanCandidate
	for _, cand := range candidates {
		score := scoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)
		results = append(results, rescanCandidate{
			Title:   cand.Title,
			Artist:  cand.Artist,
			Album:   cand.Album,
			AlbumID: cand.AlbumID,
			Score:   score,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func metadataUpdateTrackHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/update-track/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	var body struct {
		Title       string `json:"title"`
		Artist      string `json:"artist"`
		Album       string `json:"album"`
		AlbumArtist string `json:"albumArtist"`
		AlbumID     string `json:"albumId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	mu.Lock()
	track, exists := tracks[trackID]
	if !exists {
		mu.Unlock()
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	oldAlbumID := track.AlbumID
	oldHasCover := track.HasCover

	if body.Title != "" {
		track.Title = body.Title
	}
	if body.Artist != "" {
		track.Artist = body.Artist
	}
	if body.Album != "" {
		track.Album = body.Album
	}
	if body.AlbumArtist != "" {
		track.AlbumArtist = body.AlbumArtist
	}
	if track.AlbumArtist == "" {
		track.AlbumArtist = track.Artist
	}
	if track.Album != "" {
		track.AlbumID = generateAlbumID(track.AlbumArtist, track.Album)
	}
	track.HasMetadata = true

	coverDir := filepath.Join(musicDir, "images")
	os.MkdirAll(coverDir, 0755)

	if track.AlbumID != "" {
		newPath := filepath.Join(coverDir, track.AlbumID+".jpg")
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			var data []byte
			if oldAlbumID != "" {
				if d, err := os.ReadFile(filepath.Join(coverDir, oldAlbumID+".jpg")); err == nil {
					data = d
				}
			}
			if len(data) == 0 {
				coverMu.RLock()
				if d, ok := coverCache[oldAlbumID]; ok {
					data = d
				}
				coverMu.RUnlock()
			}
			if oldHasCover && len(data) == 0 {
				if picData, err := extractCoverFromFile(track.FilePath); err == nil && len(picData) > 0 {
					data = picData
				}
			}
			if len(data) > 0 {
				os.WriteFile(newPath, data, 0644)
				coverMu.Lock()
				coverCache[track.AlbumID] = data
				coverMu.Unlock()
				track.HasCover = true
			}
		}
	}

	dbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)
	if oldAlbumID != "" && track.AlbumID != oldAlbumID {
		track.HasCover = false
	}
	rebuildAlbumsFromTracks()
	mu.Unlock()

	albumIDForCover := body.AlbumID
	if albumIDForCover == "" {
		albumIDForCover = track.AlbumID
	}
	if albumIDForCover != "" {
		coverDir := filepath.Join(musicDir, "images")
		os.MkdirAll(coverDir, 0755)

		if body.AlbumID != "" {
			log.Printf("[metadata] Fetching cover from Cover Art Archive for MBID %s", body.AlbumID)
			data, _, err := mbFetchCoverArt(body.AlbumID)
			if err == nil && len(data) > 0 {
				coverPath := filepath.Join(coverDir, track.AlbumID+".jpg")
				os.WriteFile(coverPath, data, 0644)
				coverMu.Lock()
				coverCache[track.AlbumID] = data
				coverMu.Unlock()
				mu.Lock()
				track.HasCover = true
				if a, ok := albums[track.AlbumID]; ok {
					a.HasCover = true
				}
				mu.Unlock()
				log.Printf("[metadata] Cover fetched and cached for %s", track.AlbumID)
			} else {
				log.Printf("[metadata] Cover Art Archive failed for MBID %s: %v, trying search fallback", body.AlbumID, err)
				fetchAndCacheCover(track.AlbumID, track.Artist, track.Album)
			}
		} else {
			fetchAndCacheCover(track.AlbumID, track.Artist, track.Album)
		}
	}

	dbSetReviewStatus(trackID, "reviewed_ok", "[]", "rescrape")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"updated": true})
}

func metadataScanProgressHandler(w http.ResponseWriter, r *http.Request) {
	p := getScanProgress()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func metadataPendingHandler(w http.ResponseWriter, r *http.Request) {
	matches := dbGetPendingMatches()

	enriched := make([]MetadataMatch, 0, len(matches))
	for _, m := range matches {
		mu.RLock()
		if t, ok := tracks[m.TrackID]; ok {
			m.FilePath = t.FilePath
			if _, hasCover := func() ([]byte, bool) {
				coverMu.RLock()
				defer coverMu.RUnlock()
				d, e := coverCache[t.AlbumID]
				return d, e
			}(); hasCover {
				m.HasCover = true
			}
		}
		mu.RUnlock()

		if m.MBAlbumID != "" {
			coverDir := filepath.Join(musicDir, "images")
			coverPath := filepath.Join(coverDir, m.MBAlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				m.HasCover = true
			}
		}

		enriched = append(enriched, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(enriched)
}

func metadataAllHandler(w http.ResponseWriter, r *http.Request) {
	matches := dbGetAllMatches()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(matches)
}

func metadataApproveHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/approve/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !dbApproveMatch(id) {
		http.Error(w, "Match not found or not pending", http.StatusNotFound)
		return
	}

	applied := applyApprovedMatches()
	autoSortMusic()
	extractEmbeddedCovers()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"approved": true,
		"applied":  applied,
	})
}

func metadataRejectHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/reject/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !dbRejectMatch(id) {
		http.Error(w, "Match not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"rejected": true})
}

func metadataApproveAllHandler(w http.ResponseWriter, r *http.Request) {
	count := dbApproveAllMatches()
	applied := applyApprovedMatches()
	extractEmbeddedCovers()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"approved": count,
		"applied":  applied,
	})
}

func metadataClearHandler(w http.ResponseWriter, r *http.Request) {
	dbClearMatches()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"cleared": true})
}

func metadataCountsHandler(w http.ResponseWriter, r *http.Request) {
	counts := dbGetMatchCount()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

func metadataUndoHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/undo/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	trackID, ok := dbUndoMatch(id)
	if !ok {
		http.Error(w, "Match not found or not approved", http.StatusNotFound)
		return
	}

	// Restore track from file tags on next scan
	mu.Lock()
	if t, exists := tracks[trackID]; exists {
		t.HasMetadata = false
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"undone": true})
}
