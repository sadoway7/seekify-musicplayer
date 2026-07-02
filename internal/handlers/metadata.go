package handlers

import (
	"encoding/json"
	"log"
	"musicapp/internal/models"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/review"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type rescanCandidate struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	AlbumID  string  `json:"albumId"`
	Score    float64 `json:"score"`
	HasCover bool    `json:"hasCover"`
}

func MetadataScanHandler(w http.ResponseWriter, r *http.Request) {
	musicbrainz.MetaScanLock.Lock()
	if musicbrainz.MetaScan.Running {
		musicbrainz.MetaScanLock.Unlock()
		http.Error(w, "Scan already in progress", http.StatusConflict)
		return
	}
	musicbrainz.MetaScanLock.Unlock()

	store.SafeGo("meta-scan", func() { musicbrainz.ScanMetadataForTracks() })

	writeJSON(w, map[string]interface{}{
		"status": "started",
	})
}

func MetadataRescanHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	store.DB.Exec("DELETE FROM metadata_matches WHERE track_id = ?", trackID)

	store.SafeGo("meta-rescan", func() {
		searchTitle := track.Title
		searchArtist := track.Artist
		if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(scanner.TitleFromFilename(track.FilePath)) {
			searchTitle = scanner.TitleFromFilename(track.FilePath)
		}
		log.Printf("[metadata] Rescanning single track: %s - %s", searchArtist, searchTitle)

		candidates, err := musicbrainz.MbSearchRecordings(searchArtist, searchTitle, 10)
		if err != nil {
			log.Printf("[metadata] Rescan failed for %q - %q: %v", searchArtist, searchTitle, err)
			return
		}

		inserted := 0
		for _, cand := range candidates {
			score := musicbrainz.ScoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)
			if score < 0.5 {
				continue
			}

			store.Mu.RLock()
			hasCover := false
			if cand.AlbumID != "" {
				coverPath := filepath.Join(store.MusicDir, "images", cand.AlbumID+".jpg")
				if _, err := os.Stat(coverPath); err == nil {
					hasCover = true
				}
			}
			store.Mu.RUnlock()

			match := &models.MetadataMatch{
				ID:          models.GenerateUUID(),
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
			store.DbInsertMetadataMatch(match)
			inserted++
		}
		log.Printf("[metadata] Rescan complete: %d candidates found for %s - %s", inserted, searchArtist, searchTitle)
	})

	writeJSON(w, map[string]interface{}{
		"status": "started",
	})
}

func MetadataRescanSyncHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/metadata/rescan-sync/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	searchTitle := track.Title
	searchArtist := track.Artist
	if searchTitle == "" || strings.ToLower(searchTitle) == strings.ToLower(scanner.TitleFromFilename(track.FilePath)) {
		searchTitle = scanner.TitleFromFilename(track.FilePath)
	}

	results := searchMBRecordings(searchArtist, searchTitle, 50)

	writeJSON(w, results)
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

func MetadataSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, map[string]interface{}{"candidates": []interface{}{}, "total": 0, "hasMore": false})
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

	// ponytail: small interactive page (fast path — single MB query, inline
	// releases). "Find More" in the modal raises offset. Default 15 keeps
	// mega-hits snappy; the old limit=50 + 4-cascade could fire ~200 HTTP calls.
	limit := 15
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	candidates, total, err := musicbrainz.MbSearchRecordingsPaged(searchArtist, searchTitle, limit, offset)
	if err != nil {
		writeJSON(w, map[string]interface{}{"candidates": []interface{}{}, "total": 0, "hasMore": false})
		return
	}

	out := make([]rescanCandidate, 0, len(candidates))
	for _, cand := range candidates {
		score := musicbrainz.ScoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)

		store.Mu.RLock()
		hasCover := false
		if cand.AlbumID != "" {
			coverPath := filepath.Join(store.MusicDir, "images", cand.AlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				hasCover = true
			}
		}
		store.Mu.RUnlock()

		out = append(out, rescanCandidate{
			Title:    cand.Title,
			Artist:   cand.Artist,
			Album:    cand.Album,
			AlbumID:  cand.AlbumID,
			Score:    score,
			HasCover: hasCover,
		})
	}

	returned := offset + len(out)
	writeJSON(w, map[string]interface{}{
		"candidates": out,
		"total":      total,
		"hasMore":    returned < total,
	})
}

func searchMBRecordings(searchArtist, searchTitle string, limit int) []rescanCandidate {
	var results []rescanCandidate
	seen := make(map[string]bool)

	addCandidates := func(candidates []musicbrainz.MbRecordingResult) {
		for _, cand := range candidates {
			if seen[cand.RecordingID] {
				continue
			}
			seen[cand.RecordingID] = true

			score := musicbrainz.ScoreMatch(searchArtist, searchTitle, cand.Artist, cand.Title, cand.Album)

			store.Mu.RLock()
			hasCover := false
			if cand.AlbumID != "" {
				coverPath := filepath.Join(store.MusicDir, "images", cand.AlbumID+".jpg")
				if _, err := os.Stat(coverPath); err == nil {
					hasCover = true
				}
			}
			store.Mu.RUnlock()

			results = append(results, rescanCandidate{
				Title:    cand.Title,
				Artist:   cand.Artist,
				Album:    cand.Album,
				AlbumID:  cand.AlbumID,
				Score:    score,
				HasCover: hasCover,
			})
		}
	}

	if searchArtist != "" && searchTitle != "" {
		candidates, err := musicbrainz.MbSearchRecordings(searchArtist, searchTitle, limit)
		if err == nil && len(candidates) > 0 {
			addCandidates(candidates)
		}
	}

	if len(results) < 5 && searchTitle != "" {
		candidates, err := musicbrainz.MbSearchRecordings("", searchTitle, limit)
		if err == nil {
			addCandidates(candidates)
		}
	}

	if len(results) < 5 && searchArtist != "" && searchTitle != "" {
		titleWords := strings.Fields(searchTitle)
		shortTitle := searchTitle
		if len(titleWords) > 3 {
			shortTitle = strings.Join(titleWords[:3], " ")
		}
		candidates, err := musicbrainz.MbSearchRecordings(searchArtist, shortTitle, limit)
		if err == nil {
			addCandidates(candidates)
		}
	}

	if len(results) < 3 && searchTitle != "" {
		parenIdx := strings.Index(searchTitle, "(")
		bracketIdx := strings.Index(searchTitle, "[")
		cleanTitle := searchTitle
		if parenIdx > 2 {
			cleanTitle = strings.TrimSpace(searchTitle[:parenIdx])
		} else if bracketIdx > 2 {
			cleanTitle = strings.TrimSpace(searchTitle[:bracketIdx])
		}
		if cleanTitle != "" && cleanTitle != searchTitle {
			candidates, err := musicbrainz.MbSearchRecordings(searchArtist, cleanTitle, limit)
			if err == nil {
				addCandidates(candidates)
			}
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if len(results) > limit {
		results = results[:limit]
	}

	return results
}

func MetadataUpdateTrackHandler(w http.ResponseWriter, r *http.Request) {
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

	store.Mu.Lock()
	track, exists := store.Tracks[trackID]
	if !exists {
		store.Mu.Unlock()
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
		track.AlbumID = models.GenerateAlbumID(track.AlbumArtist, track.Album)
	}
	track.HasMetadata = true

	coverDir := filepath.Join(store.MusicDir, "images")
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
				store.CoverMu.RLock()
				if d, ok := store.CoverCache[oldAlbumID]; ok {
					data = d
				}
				store.CoverMu.RUnlock()
			}
			if oldHasCover && len(data) == 0 {
				if picData, err := extractCoverFromFile(track.FilePath); err == nil && len(picData) > 0 {
					data = picData
				}
			}
			if len(data) > 0 {
				os.WriteFile(newPath, data, 0644)
				store.CacheCover(track.AlbumID, data)
				track.HasCover = true
				store.MoveCustomCover(oldAlbumID, track.AlbumID)
			}
		}
	}

	store.DbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)
	if oldAlbumID != "" && track.AlbumID != oldAlbumID {
		track.HasCover = false
	}
	musicbrainz.RebuildAlbumsFromTracksLocked()
	store.Mu.Unlock()

	albumIDForCover := body.AlbumID
	if albumIDForCover == "" {
		albumIDForCover = track.AlbumID
	}
	if albumIDForCover != "" && !store.IsCustomCover(track.AlbumID) {
		coverDir := filepath.Join(store.MusicDir, "images")
		os.MkdirAll(coverDir, 0755)

		if body.AlbumID != "" {
			log.Printf("[metadata] Fetching cover from Cover Art Archive for MBID %s", body.AlbumID)
			data, _, err := musicbrainz.MbFetchCoverArt(body.AlbumID)
			if err == nil && len(data) > 0 {
				coverPath := filepath.Join(coverDir, track.AlbumID+".jpg")
				os.WriteFile(coverPath, data, 0644)
				store.CacheCover(track.AlbumID, data)
				store.Mu.Lock()
				track.HasCover = true
				if a, ok := store.Albums[track.AlbumID]; ok {
					a.HasCover = true
				}
				store.Mu.Unlock()
				log.Printf("[metadata] Cover fetched and cached for %s", track.AlbumID)
			} else {
				log.Printf("[metadata] Cover Art Archive failed for MBID %s: %v, trying search fallback", body.AlbumID, err)
				musicbrainz.FetchAndCacheCover(track.AlbumID, track.Artist, track.Album)
			}
		} else {
			musicbrainz.FetchAndCacheCover(track.AlbumID, track.Artist, track.Album)
		}
	}

	review.DbSetReviewStatus(trackID, "reviewed_ok", "[]", "rescrape")

	writeJSON(w, map[string]bool{"updated": true})
}

func MetadataScanProgressHandler(w http.ResponseWriter, r *http.Request) {
	p := musicbrainz.GetScanProgress()
	writeJSON(w, p)
}

func MetadataPendingHandler(w http.ResponseWriter, r *http.Request) {
	matches := store.DbGetPendingMatches()

	enriched := make([]models.MetadataMatch, 0, len(matches))
	for _, m := range matches {
		store.Mu.RLock()
		if t, ok := store.Tracks[m.TrackID]; ok {
			m.FilePath = t.FilePath
			if _, hasCover := func() ([]byte, bool) {
				store.CoverMu.RLock()
				defer store.CoverMu.RUnlock()
				d, e := store.CoverCache[t.AlbumID]
				return d, e
			}(); hasCover {
				m.HasCover = true
			}
		}
		store.Mu.RUnlock()

		if m.MBAlbumID != "" {
			coverDir := filepath.Join(store.MusicDir, "images")
			coverPath := filepath.Join(coverDir, m.MBAlbumID+".jpg")
			if _, err := os.Stat(coverPath); err == nil {
				m.HasCover = true
			}
		}

		enriched = append(enriched, m)
	}

	writeJSON(w, enriched)
}

func MetadataAllHandler(w http.ResponseWriter, r *http.Request) {
	matches := store.DbGetAllMatches()
	writeJSON(w, matches)
}

func MetadataApproveHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/approve/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !store.DbApproveMatch(id) {
		http.Error(w, "Match not found or not pending", http.StatusNotFound)
		return
	}

	applied := musicbrainz.ApplyApprovedMatches()
	scanner.AutoSortMusic()
	scanner.ExtractEmbeddedCovers()
	writeJSON(w, map[string]interface{}{
		"approved": true,
		"applied":  applied,
	})
}

func MetadataRejectHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/reject/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	if !store.DbRejectMatch(id) {
		http.Error(w, "Match not found", http.StatusNotFound)
		return
	}

	writeJSON(w, map[string]bool{"rejected": true})
}

func MetadataApproveAllHandler(w http.ResponseWriter, r *http.Request) {
	count := store.DbApproveAllMatches()
	applied := musicbrainz.ApplyApprovedMatches()
	scanner.ExtractEmbeddedCovers()

	writeJSON(w, map[string]interface{}{
		"approved": count,
		"applied":  applied,
	})
}

func MetadataClearHandler(w http.ResponseWriter, r *http.Request) {
	store.DbClearMatches()
	writeJSON(w, map[string]bool{"cleared": true})
}

func MetadataCountsHandler(w http.ResponseWriter, r *http.Request) {
	counts := store.DbGetMatchCount()
	writeJSON(w, counts)
}

func MetadataUndoHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/metadata/undo/")
	if id == "" {
		http.Error(w, "Match ID required", http.StatusBadRequest)
		return
	}

	trackID, ok := store.DbUndoMatch(id)
	if !ok {
		http.Error(w, "Match not found or not approved", http.StatusNotFound)
		return
	}

	// Restore track from file tags on next scan
	store.Mu.Lock()
	if t, exists := store.Tracks[trackID]; exists {
		t.HasMetadata = false
	}
	store.Mu.Unlock()

	writeJSON(w, map[string]bool{"undone": true})
}
