package musicbrainz

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"musicapp/internal/models"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func ScoreMatch(localArtist, localTitle, mbArtist, mbTitle, mbAlbum string) float64 {
	score := 0.0

	la := strings.ToLower(strings.TrimSpace(localArtist))
	lt := strings.ToLower(strings.TrimSpace(localTitle))
	ma := strings.ToLower(strings.TrimSpace(mbArtist))
	mt := strings.ToLower(strings.TrimSpace(mbTitle))

	if lt == mt {
		score += 0.5
	} else if strings.Contains(lt, mt) || strings.Contains(mt, lt) {
		score += 0.3
	}

	if la == ma {
		score += 0.5
	} else if strings.Contains(la, ma) || strings.Contains(ma, la) {
		score += 0.3
	}

	// Penalize compilation releases
	if mbAlbum != "" && IsCompilationTitle(mbAlbum) {
		score -= 0.2
	}

	return score
}

type ScanProgress struct {
	Running bool   `json:"running"`
	Total   int    `json:"total"`
	Scanned int    `json:"scanned"`
	Matched int    `json:"matched"`
	Failed  int    `json:"failed"`
	Current string `json:"current"`
	Done    bool   `json:"done"`
	Result  *models.MetadataScanResult `json:"result,omitempty"`
}

var (
	MetaScan     ScanProgress
	MetaScanLock sync.Mutex
)

func GetScanProgress() ScanProgress {
	MetaScanLock.Lock()
	defer MetaScanLock.Unlock()
	return MetaScan
}

func ScanMetadataForTracks() models.MetadataScanResult {
	MetaScanLock.Lock()
	if MetaScan.Running {
		MetaScanLock.Unlock()
		return models.MetadataScanResult{}
	}
	MetaScan = ScanProgress{Running: true}
	MetaScanLock.Unlock()

	defer func() {
		MetaScanLock.Lock()
		MetaScan.Running = false
		MetaScan.Done = true
		MetaScanLock.Unlock()
	}()

	store.Mu.RLock()
	type trackInfo struct {
		id       string
		title    string
		artist   string
		filePath string
	}

	existingMatches := map[string]bool{}
	rows, _ := store.DB.Query(`SELECT DISTINCT track_id FROM metadata_matches`)
	if rows != nil {
		for rows.Next() {
			var tid string
			rows.Scan(&tid)
			existingMatches[tid] = true
		}
		rows.Close()
	}

	var unmatched []trackInfo
	var skipped int
	for _, t := range store.Tracks {
		if existingMatches[t.ID] {
			continue
		}

		// Skip tracks that already have complete tags (e.g. Lidarr-managed files)
		if t.Artist != "" && t.Title != "" && t.Album != "" {
			skipped++
			continue
		}

		searchTitle := t.Title
		searchArtist := t.Artist

		if searchTitle == "" || searchArtist == "" {
			filename := scanner.TitleFromFilename(t.FilePath)
			if searchTitle == "" && searchArtist == "" {
				if sepIdx := strings.Index(filename, " - "); sepIdx != -1 {
					searchArtist = strings.TrimSpace(filename[:sepIdx])
					searchTitle = strings.TrimSpace(filename[sepIdx+3:])
				} else {
					searchTitle = filename
				}
			} else if searchTitle == "" {
				searchTitle = filename
			}
		}

		if searchTitle == "" {
			continue
		}

		unmatched = append(unmatched, trackInfo{
			id:       t.ID,
			title:    searchTitle,
			artist:   searchArtist,
			filePath: t.FilePath,
		})
	}
	store.Mu.RUnlock()

	var result models.MetadataScanResult
	var resultMu sync.Mutex

	MetaScanLock.Lock()
	MetaScan.Total = len(unmatched)
	MetaScanLock.Unlock()

	if skipped > 0 {
		log.Printf("[metadata] Skipped %d tracks with complete tags", skipped)
	}
	log.Printf("[metadata] Starting parallel scan of %d tracks (3 workers)...", len(unmatched))

	if len(unmatched) == 0 {
		MetaScanLock.Lock()
		MetaScan.Result = &result
		MetaScanLock.Unlock()
		return result
	}

	// Feed tracks to workers via channel
	trackCh := make(chan trackInfo, len(unmatched))
	for _, info := range unmatched {
		trackCh <- info
	}
	close(trackCh)

	const numWorkers = 2
	var wg sync.WaitGroup

	worker := func() {
		defer wg.Done()
		for info := range trackCh {
			MetaScanLock.Lock()
			MetaScan.Scanned++
			s := MetaScan.Scanned
			MetaScan.Current = info.artist + " - " + info.title
			MetaScanLock.Unlock()

			_ = s

			candidates, err := MbSearchRecordings(info.artist, info.title, 3)
			if err != nil {
				if strings.Contains(err.Error(), "503") {
					log.Printf("[metadata] Rate limited, waiting 5s before retry...")
					time.Sleep(5 * time.Second)
					candidates, err = MbSearchRecordings(info.artist, info.title, 3)
					if err != nil {
						log.Printf("[metadata] Retry failed for %q - %q: %v", info.artist, info.title, err)
						resultMu.Lock()
						result.Failed++
						MetaScanLock.Lock()
						MetaScan.Failed = result.Failed
						MetaScanLock.Unlock()
						resultMu.Unlock()
						time.Sleep(1200 * time.Millisecond)
						continue
					}
				} else {
					log.Printf("[metadata] No results for %q - %q: %v", info.artist, info.title, err)
					resultMu.Lock()
					result.Failed++
					MetaScanLock.Lock()
					MetaScan.Failed = result.Failed
					MetaScanLock.Unlock()
					resultMu.Unlock()
					time.Sleep(600 * time.Millisecond)
					continue
				}
			}

			if len(candidates) == 0 {
				resultMu.Lock()
				result.Failed++
				MetaScanLock.Lock()
				MetaScan.Failed = result.Failed
				MetaScanLock.Unlock()
				resultMu.Unlock()
				time.Sleep(600 * time.Millisecond)
				continue
			}

			for _, cand := range candidates {
				score := ScoreMatch(info.artist, info.title, cand.Artist, cand.Title, cand.Album)

				if score < 0.5 {
					continue
				}

				store.Mu.RLock()
				hasCover := false
				if cand.AlbumID != "" {
					coverDir := filepath.Join(store.MusicDir, "images")
					coverPath := filepath.Join(coverDir, cand.AlbumID+".jpg")
					if _, err := os.Stat(coverPath); err == nil {
						hasCover = true
					}
				}
				store.Mu.RUnlock()

				match := &models.MetadataMatch{
					ID:          models.GenerateUUID(),
					TrackID:     info.id,
					TrackTitle:  info.title,
					TrackArtist: info.artist,
					MBTitle:     cand.Title,
					MBArtist:    cand.Artist,
					MBAlbum:     cand.Album,
					MBAlbumID:   cand.AlbumID,
					MBScore:     score,
					Status:      "pending",
					HasCover:    hasCover,
					FilePath:    info.filePath,
				}

				store.DbInsertMetadataMatch(match)

				resultMu.Lock()
				if score >= 0.8 {
					result.Matched++
				} else {
					result.Conflicts++
				}
				result.Pending++
				MetaScanLock.Lock()
				MetaScan.Matched = result.Pending
				MetaScanLock.Unlock()
				resultMu.Unlock()
			}

			time.Sleep(600 * time.Millisecond)
		}
	}

	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go worker()
	}
	wg.Wait()

	result.Failed = MetaScan.Failed

	// Auto-approve high-confidence matches (score >= 0.8)
	autoApproved := store.DbApproveAllMatches()
	result.AutoApproved = autoApproved
	result.Pending -= autoApproved
	if result.Pending < 0 {
		result.Pending = 0
	}

	MetaScanLock.Lock()
	MetaScan.Result = &result
	MetaScanLock.Unlock()

	log.Printf("[metadata] Scan complete: %d matched, %d auto-approved, %d pending review, %d conflicts, %d failed",
		result.Matched, autoApproved, result.Pending, result.Conflicts, result.Failed)

	// Apply auto-approved matches to tracks
	if autoApproved > 0 {
		applied := ApplyApprovedMatches()
		log.Printf("[metadata] Applied %d auto-approved metadata updates", applied)
	}

	return result
}

func ApplyApprovedMatches() int {
	matches := store.DbGetAllMatches()
	applied := 0

	type coverJob struct {
		trackAlbumID string
		mbAlbumID    string
		artist       string
		album        string
	}
	var coverJobs []coverJob

	bestPerTrack := map[string]*models.MetadataMatch{}
	for i := range matches {
		m := &matches[i]
		if m.Status != "approved" {
			continue
		}
		existing, ok := bestPerTrack[m.TrackID]
		if !ok || m.MBScore > existing.MBScore || (m.MBScore == existing.MBScore && m.MBAlbumID != "") {
			bestPerTrack[m.TrackID] = m
		}
	}

	store.Mu.Lock()
	coverDir := filepath.Join(store.MusicDir, "images")
	for _, m := range bestPerTrack {
		track, exists := store.Tracks[m.TrackID]
		if !exists {
			continue
		}

		oldAlbumID := track.AlbumID
		changed := false

		if m.MBArtist != "" && track.Artist != m.MBArtist {
			track.Artist = m.MBArtist
			changed = true
		}
		if m.MBTitle != "" && track.Title != m.MBTitle {
			track.Title = m.MBTitle
			changed = true
		}
		if m.MBAlbum != "" && track.Album != m.MBAlbum {
			track.Album = m.MBAlbum
			changed = true
		}
		if m.MBArtist != "" && track.AlbumArtist == "" {
			track.AlbumArtist = m.MBArtist
			changed = true
		}

		if changed {
			if track.Album != "" {
				track.AlbumID = models.GenerateAlbumID(track.AlbumArtist, track.Album)
			}
			track.HasMetadata = true
			applied++
			store.DbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)

			if oldAlbumID != track.AlbumID {
				oldPath := filepath.Join(coverDir, oldAlbumID+".jpg")
				newPath := filepath.Join(coverDir, track.AlbumID+".jpg")
				if _, err := os.Stat(newPath); os.IsNotExist(err) {
					if data, ferr := os.ReadFile(oldPath); ferr == nil {
						os.WriteFile(newPath, data, 0644)
						store.CacheCover(track.AlbumID, data)
						store.MoveCustomCover(oldAlbumID, track.AlbumID)
					}
				}
			}
		}

		if m.MBAlbumID != "" && track.AlbumID != "" {
			coverJobs = append(coverJobs, coverJob{
				trackAlbumID: track.AlbumID,
				mbAlbumID:    m.MBAlbumID,
				artist:       m.MBArtist,
				album:        m.MBAlbum,
			})
		}
	}

	if applied > 0 {
		RebuildAlbumsFromTracks()
	}
	store.Mu.Unlock()

	go func() {
		for _, job := range coverJobs {
			if store.IsCustomCover(job.trackAlbumID) {
				continue
			}
			store.CoverMu.RLock()
			_, exists := store.CoverCache[job.trackAlbumID]
			store.CoverMu.RUnlock()
			if exists {
				continue
			}

			coverDir := filepath.Join(store.MusicDir, "images")
			os.MkdirAll(coverDir, 0755)
			coverPath := filepath.Join(coverDir, job.trackAlbumID+".jpg")

			if diskData, err := os.ReadFile(coverPath); err == nil && len(diskData) > 0 {
				store.CacheCover(job.trackAlbumID, diskData)
				store.Mu.Lock()
				if a, ok := store.Albums[job.trackAlbumID]; ok {
					a.HasCover = true
				}
				store.Mu.Unlock()
				continue
			}

			mbid := job.mbAlbumID
			if mbid != "" {
				coverURL := fmt.Sprintf("%s/release/%s/front-500", CoverArtBaseURL, mbid)
				req, err := http.NewRequest("GET", coverURL, nil)
				if err == nil {
					req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")
					resp, err := MbClient.Do(req)
					if err == nil && resp.StatusCode == 200 {
						data, _ := io.ReadAll(resp.Body)
						resp.Body.Close()
						if len(data) > 0 {
							os.WriteFile(coverPath, data, 0644)
							store.CacheCover(job.trackAlbumID, data)
							store.Mu.Lock()
							if a, ok := store.Albums[job.trackAlbumID]; ok {
								a.HasCover = true
							}
							store.Mu.Unlock()
							log.Printf("[cover] Fetched cover for %s - %s", job.artist, job.album)
							time.Sleep(800 * time.Millisecond)
							continue
						}
					}
					if resp != nil {
						resp.Body.Close()
					}
				}
			}

			FetchAndCacheCover(job.trackAlbumID, job.artist, job.album)
			time.Sleep(800 * time.Millisecond)
		}
	}()

	return applied
}

func RebuildAlbumsFromTracks() {
	newAlbums := make(map[string]*models.Album)
	coverDir := filepath.Join(store.MusicDir, "images")
	for _, t := range store.Tracks {
		if t.Album != "" {
			if _, exists := newAlbums[t.AlbumID]; !exists {
				newAlbums[t.AlbumID] = &models.Album{
					ID:     t.AlbumID,
					Name:   t.Album,
					Artist: t.AlbumArtist,
					Year:   t.Year,
				}
			}
			newAlbums[t.AlbumID].TrackCount++

			store.CoverMu.RLock()
			if _, hasCover := store.CoverCache[t.AlbumID]; hasCover {
				newAlbums[t.AlbumID].HasCover = true
			}
			store.CoverMu.RUnlock()

			if !newAlbums[t.AlbumID].HasCover {
				coverPath := filepath.Join(coverDir, t.AlbumID+".jpg")
				if _, err := os.Stat(coverPath); err == nil {
					newAlbums[t.AlbumID].HasCover = true
				}
			}

			if t.HasCover && !newAlbums[t.AlbumID].HasCover {
				newAlbums[t.AlbumID].HasCover = true
			}
		}
	}
	store.Albums = newAlbums
	for _, a := range store.Albums {
		store.DbUpsertAlbum(a)
	}
}

func MbLookupRelease(mbid string) (string, string, string, error) {
	reqURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=artist-credits", MbBaseURL, mbid)

	body, err := MbDoRequest(reqURL)
	if err != nil {
		return "", "", "", err
	}

	var lookup MbLookupResponse
	if err := json.Unmarshal(body, &lookup); err != nil {
		return "", "", "", fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	artistName := ""
	if len(lookup.ArtistCredit) > 0 {
		artistName = lookup.ArtistCredit[0].Name
	}

	year := ""
	if len(lookup.Date) >= 4 {
		year = lookup.Date[:4]
	}

	return lookup.Title, artistName, year, nil
}

func FetchMetadataForTrack(artist, title string) (string, string, string, error) {
	if artist == "" {
		artist = title
	}

	query := fmt.Sprintf("artist:%s AND recording:%s", url.QueryEscape(artist), url.QueryEscape(title))
	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=1", MbBaseURL, query)

	body, err := MbDoRequest(reqURL)
	if err != nil {
		return "", "", "", err
	}

	var result struct {
		Recordings []struct {
			Title        string          `json:"title"`
			ArtistCredit []MbArtistCredit `json:"artist-credit"`
			Releases     []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"releases"`
		} `json:"recordings"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", "", fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	if len(result.Recordings) == 0 {
		return "", "", "", fmt.Errorf("no recording found")
	}

	rec := result.Recordings[0]
	mbArtist := ""
	if len(rec.ArtistCredit) > 0 {
		mbArtist = rec.ArtistCredit[0].Name
	}

	mbAlbum := ""
	mbAlbumID := ""
	if len(rec.Releases) > 0 {
		mbAlbum = rec.Releases[0].Title
		mbAlbumID = rec.Releases[0].ID
	}

	_ = mbAlbumID
	return rec.Title, mbArtist, mbAlbum, nil
}

// ReleaseTypePriority ranks release-group types: Album is best, Compilation worst.
func ReleaseTypePriority(rgType string) int {
	switch strings.ToLower(rgType) {
	case "album":
		return 5
	case "ep":
		return 4
	case "single":
		return 3
	case "soundtrack":
		return 2
	case "live":
		return 2
	case "remix":
		return 1
	case "compilation":
		return 0
	default:
		return 1
	}
}

// MbLookupBestRelease looks up a recording by MBID and returns the best release
// (real album preferred over compilation).
func MbLookupBestRelease(recordingID string) (string, string) {
	reqURL := fmt.Sprintf("%s/recording/%s?inc=releases+release-groups&fmt=json", MbBaseURL, recordingID)

	body, err := MbDoRequest(reqURL)
	if err != nil {
		return "", ""
	}

	var lookupResp struct {
		Releases []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			ReleaseGroup struct {
				Type  string `json:"type"`
				Title string `json:"title"`
			} `json:"release-group"`
		} `json:"releases"`
	}

	if err := json.Unmarshal(body, &lookupResp); err != nil {
		return "", ""
	}

	bestTitle := ""
	bestID := ""
	bestPriority := -1

	for _, r := range lookupResp.Releases {
		p := ReleaseTypePriority(r.ReleaseGroup.Type)
		if p > bestPriority {
			bestPriority = p
			bestTitle = r.Title
			bestID = r.ID
		}
	}

	return bestTitle, bestID
}

func MbSearchRecordings(artist, title string, limit int) ([]MbRecordingResult, error) {
	var results []MbRecordingResult

	var query string
	if artist != "" && title != "" {
		query = fmt.Sprintf(`artist:"%s" AND recording:"%s"`, EscapeLucene(artist), EscapeLucene(title))
	} else if title != "" {
		query = fmt.Sprintf(`recording:"%s"`, EscapeLucene(title))
	} else {
		return results, fmt.Errorf("no search terms")
	}

	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=%d", MbBaseURL, url.QueryEscape(query), limit)

	body, err := MbDoRequest(reqURL)
	if err != nil {
		return results, err
	}

	var searchResp struct {
		Recordings []struct {
			ID           string          `json:"id"`
			Title        string          `json:"title"`
			ArtistCredit []MbArtistCredit `json:"artist-credit"`
			Releases     []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"releases"`
		} `json:"recordings"`
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {
		return results, fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	for _, rec := range searchResp.Recordings {
		artistName := ""
		if len(rec.ArtistCredit) > 0 {
			artistName = rec.ArtistCredit[0].Name
		}

		// Use the full release list via lookup to find the real album
		albumName := ""
		albumID := ""
		if rec.ID != "" {
			albumName, albumID = MbLookupBestRelease(rec.ID)
		}

		// Fallback to the search results if lookup failed
		if albumName == "" && len(rec.Releases) > 0 {
			albumName = rec.Releases[0].Title
			albumID = rec.Releases[0].ID
		}

		results = append(results, MbRecordingResult{
			RecordingID: rec.ID,
			Title:       rec.Title,
			Artist:      artistName,
			Album:       albumName,
			AlbumID:     albumID,
		})
	}

	return results, nil
}
