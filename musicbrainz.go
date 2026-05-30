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

	coverDir := filepath.Join("data", "covers")
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

func loadCachedCovers() {
	coverDir := filepath.Join("data", "covers")
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
