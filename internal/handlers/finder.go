package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"musicapp/internal/downloads"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func FinderSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	searchType := r.URL.Query().Get("type")
	if searchType == "" {
		searchType = "recording"
	}

	if q == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	limit := 20

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	switch searchType {
	case "recording":
		results, err := musicbrainz.FinderSearchRecordings(q, limit)
		if err != nil {
			log.Printf("[finder] Recording search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []musicbrainz.FinderRecording{}
		}
		json.NewEncoder(w).Encode(results)

	case "artist":
		results, err := musicbrainz.FinderSearchArtists(q, limit)
		if err != nil {
			log.Printf("[finder] Artist search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []musicbrainz.FinderArtist{}
		}
		json.NewEncoder(w).Encode(results)

	case "release":
		results, err := musicbrainz.FinderSearchReleases(q, limit)
		if err != nil {
			log.Printf("[finder] Release search error: %v", err)
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []musicbrainz.FinderRelease{}
		}
		json.NewEncoder(w).Encode(results)

	default:
		http.Error(w, `{"error":"invalid type"}`, http.StatusBadRequest)
	}
}

func FinderArtistReleasesHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/finder/artist/")

	if strings.HasSuffix(path, "/tracks") {
		mbid := strings.TrimSuffix(path, "/tracks")
		artistName := r.URL.Query().Get("artist")
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		limit := 100
		if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
			limit = l
		}
		page := musicbrainz.FinderArtistTracks(mbid, artistName, offset, limit)
		if page.Tracks == nil {
			page.Tracks = []musicbrainz.ArtistTrack{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(page)
		return
	}

	mbid := strings.TrimSuffix(path, "/releases")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	results, err := musicbrainz.FinderArtistReleases(mbid)
	if err != nil {
		log.Printf("[finder] Artist releases error: %v", err)
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []musicbrainz.FinderRelease{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(results)
}

func FinderReleaseTracksHandler(w http.ResponseWriter, r *http.Request) {
	mbid := strings.TrimPrefix(r.URL.Path, "/api/finder/release/")
	mbid = strings.TrimSuffix(mbid, "/tracks")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	results, err := musicbrainz.FinderReleaseTracks(mbid)
	if err != nil {
		log.Printf("[finder] Release tracks error: %v", err)
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []musicbrainz.FinderReleaseTrack{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(results)
}

func FinderCoverHandler(w http.ResponseWriter, r *http.Request) {
	mbid := strings.TrimPrefix(r.URL.Path, "/api/finder/cover/")
	if mbid == "" {
		http.Error(w, `{"error":"missing mbid"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=86400")

	coverDir := filepath.Join(store.MusicDir, "images", "finder")
	cachedPath := filepath.Join(coverDir, mbid+".jpg")
	if data, err := os.ReadFile(cachedPath); err == nil && len(data) > 0 {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write(data)
		return
	}

	coverURL := fmt.Sprintf("%s/release-group/%s/front-250", musicbrainz.CoverArtBaseURL, mbid)
	req, err := http.NewRequest("GET", coverURL, nil)
	if err != nil {
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := musicbrainz.MbClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		coverURL = fmt.Sprintf("%s/release/%s/front-250", musicbrainz.CoverArtBaseURL, mbid)
		req, _ = http.NewRequest("GET", coverURL, nil)
		req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")
		resp, err = musicbrainz.MbClient.Do(req)
		if err != nil || resp.StatusCode != 200 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if len(body) > 0 {
		os.MkdirAll(coverDir, 0755)
		os.WriteFile(cachedPath, body, 0644)
	}

	ct := resp.Header.Get("Content-Type")
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Write(body)
}

func checkDuplicateInLibrary(artist, title string) bool {
	store.Mu.RLock()
	defer store.Mu.RUnlock()
	for _, t := range store.Tracks {
		if strings.EqualFold(t.Artist, artist) && strings.EqualFold(t.Title, title) {
			return true
		}
	}
	return false
}

type youtubeSearchResult struct {
	VideoID   string `json:"videoId"`
	Title     string `json:"title"`
	Channel   string `json:"channel"`
	Duration  int    `json:"duration"`
	InLibrary bool   `json:"inLibrary"`
}

func YoutubeSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	ytdlpPath := downloads.FindYtDlp()
	if ytdlpPath == "" {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytsearch10:%s", q),
	)
	output, err := cmd.Output()
	if err != nil {
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	var results []youtubeSearchResult
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry struct {
			ID       string  `json:"id"`
			Title    string  `json:"title"`
			Channel  string  `json:"channel"`
			Duration float64 `json:"duration"`
		}
		if json.Unmarshal([]byte(line), &entry) != nil || entry.ID == "" || entry.Duration < 10 {
			continue
		}

		artist := entry.Channel
		title := entry.Title
		if idx := strings.Index(title, " - "); idx > 0 {
			a := strings.TrimSpace(title[:idx])
			t := strings.TrimSpace(title[idx+3:])
			if a != "" && t != "" {
				artist = a
				title = t
			}
		}

		inLib := checkDuplicateInLibrary(artist, title)

		results = append(results, youtubeSearchResult{
			VideoID:   entry.ID,
			Title:     title,
			Channel:   artist,
			Duration:  int(entry.Duration),
			InLibrary: inLib,
		})
	}

	if results == nil {
		results = []youtubeSearchResult{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func ArtistTrackProgressHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(musicbrainz.GetArtistTrackProgress())
}
