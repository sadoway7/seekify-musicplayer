package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"musicapp/internal/store"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

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
	return filepath.Join(store.MusicDir, "images", "artists", artistArtKey(name)+".jpg")
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

	artDir := filepath.Join(store.MusicDir, "images", "artists")
	os.MkdirAll(artDir, 0755)

	artFile := filepath.Join(artDir, key+".jpg")
	if data, err := os.ReadFile(artFile); err == nil {
		if len(data) > 0 {
			artistArtMu.Lock()
			artistArtCache[key] = data
			artistArtMu.Unlock()
			return true
		}
		return false
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
		os.WriteFile(artFile, []byte{}, 0644)
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

var (
	artFetchMu  sync.Mutex
	artFetching bool
)

func fetchMissingArtistArt() {
	if !store.GetSettingBool("artist_art_fetch_enabled", true) {
		return
	}
	artFetchMu.Lock()
	if artFetching {
		artFetchMu.Unlock()
		return
	}
	artFetching = true
	artFetchMu.Unlock()
	defer func() {
		artFetchMu.Lock()
		artFetching = false
		artFetchMu.Unlock()
	}()

	store.Mu.RLock()
	type artistInfo struct {
		name string
	}
	var artists []artistInfo
	seen := map[string]bool{}
	for _, t := range store.Tracks {
		n := t.Artist
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		artists = append(artists, artistInfo{name: n})
	}
	store.Mu.RUnlock()

	log.Printf("[artist-art] Fetching images for %d artists...", len(artists))

	for _, a := range artists {
		fetchArtistImage(a.name)
		time.Sleep(400 * time.Millisecond)
	}
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

	coverDir := filepath.Join(store.MusicDir, "images")
	os.MkdirAll(coverDir, 0755)

	coverPath := filepath.Join(coverDir, albumID+".jpg")
	if _, err := os.Stat(coverPath); err == nil {
		data, err := os.ReadFile(coverPath)
		if err == nil {
			store.CoverMu.Lock()
			store.CoverCache[albumID] = data
			store.CoverMu.Unlock()
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

	store.CoverMu.Lock()
	store.CoverCache[albumID] = data
	store.CoverMu.Unlock()

	store.Mu.Lock()
	if a, ok := store.Albums[albumID]; ok {
		a.HasCover = true
	}
	store.Mu.Unlock()

	log.Printf("MusicBrainz: fetched cover for %s - %s", artist, album)
	return true
}

var (
	coverFetchMu  sync.Mutex
	coverFetching bool
)

func fetchMissingCovers() {
	if !store.GetSettingBool("cover_fetch_enabled", true) {
		return
	}
	coverFetchMu.Lock()
	if coverFetching {
		coverFetchMu.Unlock()
		return
	}
	coverFetching = true
	coverFetchMu.Unlock()
	defer func() {
		coverFetchMu.Lock()
		coverFetching = false
		coverFetchMu.Unlock()
	}()

	store.Mu.RLock()
	type albumInfo struct {
		id     string
		artist string
		name   string
	}
	var missing []albumInfo
	for _, a := range store.Albums {
		if !a.HasCover && a.Name != "" && a.Artist != "" {
			missing = append(missing, albumInfo{a.ID, a.Artist, a.Name})
		}
	}
	store.Mu.RUnlock()

	log.Printf("Fetching missing covers for %d albums from MusicBrainz...", len(missing))

	for _, info := range missing {
		fetchAndCacheCover(info.id, info.artist, info.name)
		time.Sleep(800 * time.Millisecond)
	}
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
