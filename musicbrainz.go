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
	"time"
)

var mbClient = &http.Client{Timeout: 10 * time.Second}

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

func mbSearchRelease(artist, album string) (string, error) {
	query := fmt.Sprintf("artist:%s AND release:%s", url.QueryEscape(artist), url.QueryEscape(album))
	reqURL := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=1", mbBaseURL, query)

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var searchResp mbSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return "", err
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

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", "", err
	}

	var lookup mbLookupResponse
	if err := json.Unmarshal(body, &lookup); err != nil {
		return "", "", "", err
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

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
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
		return "", "", "", err
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

func mbSearchRecordings(artist, title string, limit int) ([]mbRecordingResult, error) {
	var results []mbRecordingResult

	var query string
	if artist != "" && title != "" {
		query = fmt.Sprintf("artist:%s AND recording:%s", url.QueryEscape(artist), url.QueryEscape(title))
	} else if title != "" {
		query = fmt.Sprintf("recording:%s", url.QueryEscape(title))
	} else {
		return results, fmt.Errorf("no search terms")
	}

	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=%d", mbBaseURL, query, limit)

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return results, err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
	if err != nil {
		return results, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
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
		return results, err
	}

	for _, rec := range searchResp.Recordings {
		artistName := ""
		if len(rec.ArtistCredit) > 0 {
			artistName = rec.ArtistCredit[0].Name
		}

		albumName := ""
		albumID := ""
		if len(rec.Releases) > 0 {
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

func scoreMatch(localArtist, localTitle, mbArtist, mbTitle string) float64 {
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

	return score
}

func scanMetadataForTracks() MetadataScanResult {
	var result MetadataScanResult

	mu.RLock()
	type trackInfo struct {
		id       string
		title    string
		artist   string
		filePath string
	}
	var unmatched []trackInfo
	for _, t := range tracks {
		if t.Artist == "" && t.Title == "" {
			continue
		}
		if !t.HasMetadata {
			unmatched = append(unmatched, trackInfo{
				id:       t.ID,
				title:    t.Title,
				artist:   t.Artist,
				filePath: t.FilePath,
			})
		}
	}
	mu.RUnlock()

	log.Printf("Scanning metadata for %d unmatched tracks via MusicBrainz...", len(unmatched))

	for _, info := range unmatched {
		candidates, err := mbSearchRecordings(info.artist, info.title, 3)
		if err != nil {
			log.Printf("MusicBrainz: no results for %s - %s: %v", info.artist, info.title, err)
			result.Failed++
			time.Sleep(600 * time.Millisecond)
			continue
		}

		if len(candidates) == 0 {
			result.Failed++
			time.Sleep(600 * time.Millisecond)
			continue
		}

		for _, cand := range candidates {
			score := scoreMatch(info.artist, info.title, cand.Artist, cand.Title)

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

			if score >= 0.8 {
				match.Status = "pending"
				if score >= 0.9 && len(candidates) == 1 {
					match.Status = "pending"
				}
			} else if score >= 0.5 {
				match.Status = "pending"
			} else {
				continue
			}

			dbInsertMetadataMatch(match)

			if score >= 0.8 {
				result.Matched++
			} else {
				result.Conflicts++
			}
			result.Pending++
		}

		time.Sleep(600 * time.Millisecond)
	}

	log.Printf("Metadata scan complete: %d matched, %d conflicts, %d failed", result.Matched, result.Conflicts, result.Failed)
	return result
}

func applyApprovedMatches() int {
	matches := dbGetAllMatches()
	applied := 0

	mu.Lock()
	defer mu.Unlock()

	for _, m := range matches {
		if m.Status != "approved" {
			continue
		}

		track, exists := tracks[m.TrackID]
		if !exists {
			continue
		}

		changed := false

		if m.MBArtist != "" && (track.Artist == "" || strings.ToLower(track.Artist) == strings.ToLower(titleFromFilename(track.FilePath))) {
			track.Artist = m.MBArtist
			changed = true
		}
		if m.MBTitle != "" && (track.Title == "" || strings.ToLower(track.Title) == strings.ToLower(titleFromFilename(track.FilePath))) {
			track.Title = m.MBTitle
			changed = true
		}
		if m.MBAlbum != "" && track.Album == "" {
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
		}

		if m.MBAlbumID != "" {
			fetchAndCacheCover(m.MBAlbumID, m.MBArtist, m.MBAlbum)
		}
	}

	if applied > 0 {
		rebuildAlbumsFromTracks()
	}

	return applied
}

func rebuildAlbumsFromTracks() {
	newAlbums := make(map[string]*Album)
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

			if t.HasCover && !newAlbums[t.AlbumID].HasCover {
				newAlbums[t.AlbumID].HasCover = true
			}
		}
	}
	albums = newAlbums
}

func loadCachedCovers() {
	coverDir := filepath.Join(musicDir, "images")
	entries, err := os.ReadDir(coverDir)
	if err != nil {
		return
	}

	coverMu.Lock()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".jpg") {
			continue
		}
		albumID := strings.TrimSuffix(name, ".jpg")
		data, err := os.ReadFile(filepath.Join(coverDir, name))
		if err == nil {
			coverCache[albumID] = data
		}
	}
	coverMu.Unlock()

	log.Printf("Loaded %d cached covers", len(coverCache))
}
