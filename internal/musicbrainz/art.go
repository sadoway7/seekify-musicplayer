package musicbrainz

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
	ArtistArtCache map[string][]byte
	ArtistArtMu    sync.RWMutex
)

func init() {
	ArtistArtCache = make(map[string][]byte)
}

func ArtistArtKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func ArtistArtPath(name string) string {
	return filepath.Join(store.MusicDir, "images", "artists", ArtistArtKey(name)+".jpg")
}

func FetchArtistImage(artistName string) bool {
	if artistName == "" {
		return false
	}

	key := ArtistArtKey(artistName)

	ArtistArtMu.RLock()
	_, cached := ArtistArtCache[key]
	ArtistArtMu.RUnlock()
	if cached {
		return true
	}

	artDir := filepath.Join(store.MusicDir, "images", "artists")
	os.MkdirAll(artDir, 0755)

	artFile := filepath.Join(artDir, key+".jpg")
	if data, err := os.ReadFile(artFile); err == nil {
		if len(data) > 0 {
			ArtistArtMu.Lock()
			ArtistArtCache[key] = data
			ArtistArtMu.Unlock()
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

	resp, err := MbClient.Do(req)
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

	imgResp, err := MbClient.Do(imgReq)
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

	ArtistArtMu.Lock()
	ArtistArtCache[key] = imgData
	ArtistArtMu.Unlock()

	log.Printf("[artist-art] Fetched image for %q", artistName)
	return true
}

var (
	ArtFetchMu  sync.Mutex
	ArtFetching bool
)

func FetchMissingArtistArt() {
	if !store.GetSettingBool("artist_art_fetch_enabled", true) {
		return
	}
	ArtFetchMu.Lock()
	if ArtFetching {
		ArtFetchMu.Unlock()
		return
	}
	ArtFetching = true
	ArtFetchMu.Unlock()
	defer func() {
		ArtFetchMu.Lock()
		ArtFetching = false
		ArtFetchMu.Unlock()
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
		FetchArtistImage(a.name)
		time.Sleep(400 * time.Millisecond)
	}
}

func MbSearchRelease(artist, album string) (string, error) {
	query := fmt.Sprintf(`artist:"%s" AND release:"%s"`, EscapeLucene(artist), EscapeLucene(album))
	reqURL := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=1", MbBaseURL, url.QueryEscape(query))

	body, err := MbDoRequest(reqURL)
	if err != nil {
		return "", err
	}

	var searchResp MbSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return "", fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	if len(searchResp.Releases) == 0 {
		return "", fmt.Errorf("no release found")
	}

	return searchResp.Releases[0].ID, nil
}

func MbFetchCoverArt(mbid string) ([]byte, string, error) {
	reqURL := fmt.Sprintf("%s/release/%s/front-500", CoverArtBaseURL, mbid)

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := MbClient.Do(req)
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

func FetchAndCacheCoverByMBID(albumID, releaseMBID string) bool {
	if albumID == "" || releaseMBID == "" {
		return false
	}
	if store.IsCustomCover(albumID) {
		return true
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

	data, _, err := MbFetchCoverArt(releaseMBID)
	if err != nil {
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

	return true
}

func FetchAndCacheCover(albumID, artist, album string) bool {
	if album == "" || artist == "" {
		return false
	}
	if store.IsCustomCover(albumID) {
		return true
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

	mbid, err := MbSearchRelease(artist, album)
	if err != nil {
		log.Printf("MusicBrainz: no release found for %s - %s: %v", artist, album, err)
		return false
	}

	data, _, err := MbFetchCoverArt(mbid)
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
	CoverFetchMu  sync.Mutex
	CoverFetching bool
)

func FetchMissingCovers() {
	if !store.GetSettingBool("cover_fetch_enabled", true) {
		return
	}
	CoverFetchMu.Lock()
	if CoverFetching {
		CoverFetchMu.Unlock()
		return
	}
	CoverFetching = true
	CoverFetchMu.Unlock()
	defer func() {
		CoverFetchMu.Lock()
		CoverFetching = false
		CoverFetchMu.Unlock()
	}()

	store.Mu.RLock()
	type albumInfo struct {
		id     string
		artist string
		name   string
	}
	var missing []albumInfo
	for _, a := range store.Albums {
		if !a.HasCover && a.Name != "" && a.Artist != "" && !store.IsCustomCover(a.ID) {
			missing = append(missing, albumInfo{a.ID, a.Artist, a.Name})
		}
	}
	store.Mu.RUnlock()

	log.Printf("Fetching missing covers for %d albums from MusicBrainz...", len(missing))

	for _, info := range missing {
		FetchAndCacheCover(info.id, info.artist, info.name)
		time.Sleep(800 * time.Millisecond)
	}
}

func IsCompilationTitle(title string) bool {
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
