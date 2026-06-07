package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var mbClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	},
}

const mbBaseURL = "https://musicbrainz.org/ws/2"
const coverArtBaseURL = "https://coverartarchive.org"

type mbSearchResponse struct {
	Releases []mbRelease `json:"releases"`
}

type mbRelease struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Artist  []mbArtistCredit
	Date    string `json:"date"`
	TrackCount int `json:"track-count"`
}

type mbArtistCredit struct {
	Name string `json:"name"`
}

func mbDoRequest(reqURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 503 {
		return nil, fmt.Errorf("rate limited by MusicBrainz (503)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("MusicBrainz returned HTTP %d", resp.StatusCode)
	}

	return body, nil
}

func escapeLucene(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, `+`, `\+`)
	s = strings.ReplaceAll(s, `-`, `\-`)
	s = strings.ReplaceAll(s, `&&`, `\&&`)
	s = strings.ReplaceAll(s, `||`, `\||`)
	s = strings.ReplaceAll(s, `!`, `\!`)
	s = strings.ReplaceAll(s, `(`, `\(`)
	s = strings.ReplaceAll(s, `)`, `\)`)
	s = strings.ReplaceAll(s, `{`, `\{`)
	s = strings.ReplaceAll(s, `}`, `\}`)
	s = strings.ReplaceAll(s, `[`, `\[`)
	s = strings.ReplaceAll(s, `]`, `\]`)
	s = strings.ReplaceAll(s, `^`, `\^`)
	s = strings.ReplaceAll(s, `~`, `\~`)
	s = strings.ReplaceAll(s, `*`, `\*`)
	s = strings.ReplaceAll(s, `?`, `\?`)
	s = strings.ReplaceAll(s, `:`, `\:`)
	s = strings.ReplaceAll(s, `/`, `\/`)
	return s
}

func mbSearchRelease(artist, album string) (string, error) {
	query := fmt.Sprintf(`artist:"%s" AND release:"%s"`, escapeLucene(artist), escapeLucene(album))
	reqURL := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=1", mbBaseURL, url.QueryEscape(query))

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return "", err
	}

	var searchResp mbSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return "", fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	if len(searchResp.Releases) == 0 {
		return "", fmt.Errorf("no release found")
	}

	return searchResp.Releases[0].ID, nil
}

func mbFetchCoverArt(mbid string) ([]byte, string, error) {
	reqURL := fmt.Sprintf("%s/release/%s/front-500", coverArtBaseURL, mbid)

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, "", fmt.Errorf("cover art not found: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	contentType := resp.Header.Get("Content-Type")
	return data, contentType, nil
}

func fetchAndCacheCover(albumID, artist, album string) bool {
	if album == "" || artist == "" {
		return false
	}

	coverDir := filepath.Join(musicDir, "images")
	os.MkdirAll(coverDir, 0755)

	coverPath := filepath.Join(coverDir, albumID+".jpg")
	if _, err := os.Stat(coverPath); err == nil {
		data, err := os.ReadFile(coverPath)
		if err == nil {
			coverMu.Lock()
			coverCache[albumID] = data
			coverMu.Unlock()
			return true
		}
	}

	mbid, err := mbSearchRelease(artist, album)
	if err != nil {
		log.Printf("MusicBrainz: no release found for %s - %s: %v", artist, album, err)
		return false
	}

	data, _, err := mbFetchCoverArt(mbid)
	if err != nil {
		log.Printf("Cover Art Archive: no cover for MBID %s: %v", mbid, err)
		return false
	}

	os.WriteFile(coverPath, data, 0644)

	coverMu.Lock()
	coverCache[albumID] = data
	coverMu.Unlock()

	mu.Lock()
	if a, ok := albums[albumID]; ok {
		a.HasCover = true
	}
	mu.Unlock()

	log.Printf("MusicBrainz: fetched cover for %s - %s", artist, album)
	return true
}

func fetchMissingCovers() {
	mu.RLock()
	type albumInfo struct {
		id     string
		artist string
		name   string
	}
	var missing []albumInfo
	for _, a := range albums {
		if !a.HasCover && a.Name != "" && a.Artist != "" {
			missing = append(missing, albumInfo{a.ID, a.Artist, a.Name})
		}
	}
	mu.RUnlock()

	log.Printf("Fetching missing covers for %d albums from MusicBrainz...", len(missing))

	for _, info := range missing {
		fetchAndCacheCover(info.id, info.artist, info.name)
		time.Sleep(800 * time.Millisecond)
	}
}

type mbLookupResponse struct {
	Title       string `json:"title"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	Date        string `json:"date"`
}

func mbLookupRelease(mbid string) (string, string, string, error) {
	reqURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=artist-credits", mbBaseURL, mbid)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return "", "", "", err
	}

	var lookup mbLookupResponse
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

func fetchMetadataForTrack(artist, title string) (string, string, string, error) {
	if artist == "" {
		artist = title
	}

	query := fmt.Sprintf("artist:%s AND recording:%s", url.QueryEscape(artist), url.QueryEscape(title))
	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=1", mbBaseURL, query)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return "", "", "", err
	}

	var result struct {
		Recordings []struct {
			Title  string `json:"title"`
			ArtistCredit []mbArtistCredit `json:"artist-credit"`
			Releases []struct {
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

// releaseTypePriority ranks release-group types: Album is best, Compilation worst.
func releaseTypePriority(rgType string) int {
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

// mbLookupBestRelease looks up a recording by MBID and returns the best release
// (real album preferred over compilation).
func mbLookupBestRelease(recordingID string) (string, string) {
	reqURL := fmt.Sprintf("%s/recording/%s?inc=releases+release-groups&fmt=json", mbBaseURL, recordingID)

	body, err := mbDoRequest(reqURL)
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
		p := releaseTypePriority(r.ReleaseGroup.Type)
		if p > bestPriority {
			bestPriority = p
			bestTitle = r.Title
			bestID = r.ID
		}
	}

	return bestTitle, bestID
}

func isCompilationTitle(title string) bool {
	t := strings.ToLower(title)
	keywords := []string{
		"best of", "greatest hits", "compilation", "collection",
		"anthology", "essential", "ultimate", "various artists",
		"now that's what i call", "gold - greatest", "very best of",
		"definitive collection", "number ones", "top hits",
		"cream of", "classic hits", "100 hits",
	}
	for _, kw := range keywords {
		if strings.Contains(t, kw) {
			return true
		}
	}
	return false
}

func mbSearchRecordings(artist, title string, limit int) ([]mbRecordingResult, error) {
	var results []mbRecordingResult

	var query string
	if artist != "" && title != "" {
		query = fmt.Sprintf(`artist:"%s" AND recording:"%s"`, escapeLucene(artist), escapeLucene(title))
	} else if title != "" {
		query = fmt.Sprintf(`recording:"%s"`, escapeLucene(title))
	} else {
		return results, fmt.Errorf("no search terms")
	}

	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=%d", mbBaseURL, url.QueryEscape(query), limit)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return results, err
	}

	var searchResp struct {
		Recordings []struct {
			ID           string          `json:"id"`
			Title        string          `json:"title"`
			ArtistCredit []mbArtistCredit `json:"artist-credit"`
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
			albumName, albumID = mbLookupBestRelease(rec.ID)
		}

		// Fallback to the search results if lookup failed
		if albumName == "" && len(rec.Releases) > 0 {
			albumName = rec.Releases[0].Title
			albumID = rec.Releases[0].ID
		}

		results = append(results, mbRecordingResult{
			RecordingID: rec.ID,
			Title:       rec.Title,
			Artist:      artistName,
			Album:       albumName,
			AlbumID:     albumID,
		})
	}

	return results, nil
}

type mbRecordingResult struct {
	RecordingID string
	Title       string
	Artist      string
	Album       string
	AlbumID     string
}

func scoreMatch(localArtist, localTitle, mbArtist, mbTitle, mbAlbum string) float64 {
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
	if mbAlbum != "" && isCompilationTitle(mbAlbum) {
		score -= 0.2
	}

	return score
}

type scanProgress struct {
	Running    bool   `json:"running"`
	Total      int    `json:"total"`
	Scanned    int    `json:"scanned"`
	Matched    int    `json:"matched"`
	Failed     int    `json:"failed"`
	Current    string `json:"current"`
	Done       bool   `json:"done"`
	Result     *MetadataScanResult `json:"result,omitempty"`
}

var (
	metaScan     scanProgress
	metaScanLock sync.Mutex
)

func getScanProgress() scanProgress {
	metaScanLock.Lock()
	defer metaScanLock.Unlock()
	return metaScan
}

func scanMetadataForTracks() MetadataScanResult {
	metaScanLock.Lock()
	if metaScan.Running {
		metaScanLock.Unlock()
		return MetadataScanResult{}
	}
	metaScan = scanProgress{Running: true}
	metaScanLock.Unlock()

	defer func() {
		metaScanLock.Lock()
		metaScan.Running = false
		metaScan.Done = true
		metaScanLock.Unlock()
	}()

	mu.RLock()
	type trackInfo struct {
		id       string
		title    string
		artist   string
		filePath string
	}

	existingMatches := map[string]bool{}
	rows, _ := db.Query(`SELECT DISTINCT track_id FROM metadata_matches`)
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
	for _, t := range tracks {
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
			filename := titleFromFilename(t.FilePath)
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
	mu.RUnlock()

	var result MetadataScanResult
	var resultMu sync.Mutex

	metaScanLock.Lock()
	metaScan.Total = len(unmatched)
	metaScanLock.Unlock()

	if skipped > 0 {
		log.Printf("[metadata] Skipped %d tracks with complete tags", skipped)
	}
	log.Printf("[metadata] Starting parallel scan of %d tracks (3 workers)...", len(unmatched))

	if len(unmatched) == 0 {
		metaScanLock.Lock()
		metaScan.Result = &result
		metaScanLock.Unlock()
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
			metaScanLock.Lock()
			metaScan.Scanned++
			s := metaScan.Scanned
			metaScan.Current = info.artist + " - " + info.title
			metaScanLock.Unlock()

			_ = s

			candidates, err := mbSearchRecordings(info.artist, info.title, 3)
			if err != nil {
				if strings.Contains(err.Error(), "503") {
					log.Printf("[metadata] Rate limited, waiting 5s before retry...")
					time.Sleep(5 * time.Second)
					candidates, err = mbSearchRecordings(info.artist, info.title, 3)
					if err != nil {
						log.Printf("[metadata] Retry failed for %q - %q: %v", info.artist, info.title, err)
						resultMu.Lock()
						result.Failed++
						metaScanLock.Lock()
						metaScan.Failed = result.Failed
						metaScanLock.Unlock()
						resultMu.Unlock()
						time.Sleep(1200 * time.Millisecond)
						continue
					}
				} else {
					log.Printf("[metadata] No results for %q - %q: %v", info.artist, info.title, err)
					resultMu.Lock()
					result.Failed++
					metaScanLock.Lock()
					metaScan.Failed = result.Failed
					metaScanLock.Unlock()
					resultMu.Unlock()
					time.Sleep(600 * time.Millisecond)
					continue
				}
			}

			if len(candidates) == 0 {
				resultMu.Lock()
				result.Failed++
				metaScanLock.Lock()
				metaScan.Failed = result.Failed
				metaScanLock.Unlock()
				resultMu.Unlock()
				time.Sleep(600 * time.Millisecond)
				continue
			}

			for _, cand := range candidates {
				score := scoreMatch(info.artist, info.title, cand.Artist, cand.Title, cand.Album)

				if score < 0.5 {
					continue
				}

				mu.RLock()
				hasCover := false
				if cand.AlbumID != "" {
					coverDir := filepath.Join(musicDir, "images")
					coverPath := filepath.Join(coverDir, cand.AlbumID+".jpg")
					if _, err := os.Stat(coverPath); err == nil {
						hasCover = true
					}
				}
				mu.RUnlock()

				match := &MetadataMatch{
					ID:          generateUUID(),
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

				dbInsertMetadataMatch(match)

				resultMu.Lock()
				if score >= 0.8 {
					result.Matched++
				} else {
					result.Conflicts++
				}
				result.Pending++
				metaScanLock.Lock()
				metaScan.Matched = result.Pending
				metaScanLock.Unlock()
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

	result.Failed = metaScan.Failed

	// Auto-approve high-confidence matches (score >= 0.8)
	autoApproved := dbApproveAllMatches()
	result.AutoApproved = autoApproved
	result.Pending -= autoApproved
	if result.Pending < 0 {
		result.Pending = 0
	}

	metaScanLock.Lock()
	metaScan.Result = &result
	metaScanLock.Unlock()

	log.Printf("[metadata] Scan complete: %d matched, %d auto-approved, %d pending review, %d conflicts, %d failed",
		result.Matched, autoApproved, result.Pending, result.Conflicts, result.Failed)

	// Apply auto-approved matches to tracks
	if autoApproved > 0 {
		applied := applyApprovedMatches()
		log.Printf("[metadata] Applied %d auto-approved metadata updates", applied)
	}

	return result
}

func applyApprovedMatches() int {
	matches := dbGetAllMatches()
	applied := 0

	type coverJob struct {
		trackAlbumID string
		mbAlbumID    string
		artist       string
		album        string
	}
	var coverJobs []coverJob

	bestPerTrack := map[string]*MetadataMatch{}
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

	mu.Lock()
	coverDir := filepath.Join(musicDir, "images")
	for _, m := range bestPerTrack {
		track, exists := tracks[m.TrackID]
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
				track.AlbumID = generateAlbumID(track.AlbumArtist, track.Album)
			}
			track.HasMetadata = true
			applied++
			dbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)

			if oldAlbumID != track.AlbumID {
				oldPath := filepath.Join(coverDir, oldAlbumID+".jpg")
				newPath := filepath.Join(coverDir, track.AlbumID+".jpg")
				if _, err := os.Stat(newPath); os.IsNotExist(err) {
					if data, ferr := os.ReadFile(oldPath); ferr == nil {
						os.WriteFile(newPath, data, 0644)
						coverMu.Lock()
						coverCache[track.AlbumID] = data
						coverMu.Unlock()
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
		rebuildAlbumsFromTracks()
	}
	mu.Unlock()

	go func() {
		for _, job := range coverJobs {
			coverMu.RLock()
			_, exists := coverCache[job.trackAlbumID]
			coverMu.RUnlock()
			if exists {
				continue
			}

			coverDir := filepath.Join(musicDir, "images")
			os.MkdirAll(coverDir, 0755)
			coverPath := filepath.Join(coverDir, job.trackAlbumID+".jpg")

			if diskData, err := os.ReadFile(coverPath); err == nil && len(diskData) > 0 {
				coverMu.Lock()
				coverCache[job.trackAlbumID] = diskData
				coverMu.Unlock()
				mu.Lock()
				if a, ok := albums[job.trackAlbumID]; ok {
					a.HasCover = true
				}
				mu.Unlock()
				continue
			}

			mbid := job.mbAlbumID
			if mbid != "" {
				coverURL := fmt.Sprintf("%s/release/%s/front-500", coverArtBaseURL, mbid)
				req, err := http.NewRequest("GET", coverURL, nil)
				if err == nil {
					req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")
					resp, err := mbClient.Do(req)
					if err == nil && resp.StatusCode == 200 {
						data, _ := io.ReadAll(resp.Body)
						resp.Body.Close()
						if len(data) > 0 {
							os.WriteFile(coverPath, data, 0644)
							coverMu.Lock()
							coverCache[job.trackAlbumID] = data
							coverMu.Unlock()
							mu.Lock()
							if a, ok := albums[job.trackAlbumID]; ok {
								a.HasCover = true
							}
							mu.Unlock()
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

			fetchAndCacheCover(job.trackAlbumID, job.artist, job.album)
			time.Sleep(800 * time.Millisecond)
		}
	}()

	return applied
}

func rebuildAlbumsFromTracks() {
	newAlbums := make(map[string]*Album)
	coverDir := filepath.Join(musicDir, "images")
	for _, t := range tracks {
		if t.Album != "" {
			if _, exists := newAlbums[t.AlbumID]; !exists {
				newAlbums[t.AlbumID] = &Album{
					ID:     t.AlbumID,
					Name:   t.Album,
					Artist: t.AlbumArtist,
					Year:   t.Year,
				}
			}
			newAlbums[t.AlbumID].TrackCount++

			coverMu.RLock()
			if _, hasCover := coverCache[t.AlbumID]; hasCover {
				newAlbums[t.AlbumID].HasCover = true
			}
			coverMu.RUnlock()

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
	albums = newAlbums
	for _, a := range albums {
		dbUpsertAlbum(a)
	}
}

// ── Artist art ──

var (
	artistArtCache map[string][]byte
	artistArtMu    sync.RWMutex
)

func init() {
	artistArtCache = make(map[string][]byte)
}

func artistArtKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func artistArtPath(name string) string {
	return filepath.Join(musicDir, "images", "artists", artistArtKey(name)+".jpg")
}

func fetchArtistImage(artistName string) bool {
	if artistName == "" {
		return false
	}

	key := artistArtKey(artistName)

	artistArtMu.RLock()
	_, cached := artistArtCache[key]
	artistArtMu.RUnlock()
	if cached {
		return true
	}

	artDir := filepath.Join(musicDir, "images", "artists")
	os.MkdirAll(artDir, 0755)

	artFile := filepath.Join(artDir, key+".jpg")
	if data, err := os.ReadFile(artFile); err == nil && len(data) > 0 {
		artistArtMu.Lock()
		artistArtCache[key] = data
		artistArtMu.Unlock()
		return true
	}

	// Search Deezer for artist image (free, no API key)
	searchURL := fmt.Sprintf("https://api.deezer.com/search/artist?q=%s&limit=1", url.QueryEscape(artistName))

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		log.Printf("[artist-art] Deezer search failed for %q: %v", artistName, err)
		return false
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	var deezerResp struct {
		Data []struct {
			PictureBig string `json:"picture_big"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &deezerResp); err != nil {
		return false
	}

	if len(deezerResp.Data) == 0 || deezerResp.Data[0].PictureBig == "" {
		log.Printf("[artist-art] No Deezer result for %q", artistName)
		return false
	}

	imgURL := deezerResp.Data[0].PictureBig
	imgReq, err := http.NewRequest("GET", imgURL, nil)
	if err != nil {
		return false
	}
	imgReq.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	imgResp, err := mbClient.Do(imgReq)
	if err != nil {
		return false
	}
	defer imgResp.Body.Close()

	if imgResp.StatusCode != 200 {
		return false
	}

	imgData, err := io.ReadAll(imgResp.Body)
	if err != nil || len(imgData) == 0 {
		return false
	}

	os.WriteFile(artFile, imgData, 0644)

	artistArtMu.Lock()
	artistArtCache[key] = imgData
	artistArtMu.Unlock()

	log.Printf("[artist-art] Fetched image for %q", artistName)
	return true
}

func fetchMissingArtistArt() {
	mu.RLock()
	type artistInfo struct {
		name string
	}
	var artists []artistInfo
	seen := map[string]bool{}
	for _, t := range tracks {
		n := t.Artist
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		artists = append(artists, artistInfo{name: n})
	}
	mu.RUnlock()

	log.Printf("[artist-art] Fetching images for %d artists...", len(artists))

	for _, a := range artists {
		fetchArtistImage(a.name)
		time.Sleep(400 * time.Millisecond)
	}
}
