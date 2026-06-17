package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"musicapp/internal/downloads"
	"musicapp/internal/musicbrainz"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func RipperV2Handler(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "ripperv2.html")
}

func ResolveURLHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, `{"error":"url required"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath := downloads.FindYtDlp()
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not found"}`, http.StatusInternalServerError)
		return
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		req.URL,
	)
	output, err := cmd.Output()
	if err != nil {
		cmd := exec.Command(ytdlpPath,
			append(downloads.YtCommonArgs(),
				"--dump-json",
				"--no-warnings",
				"--no-download",
				req.URL,
			)...)
		output, err = cmd.Output()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "yt-dlp failed: " + string(output)})
			return
		}
	}

	var info struct {
		Title      string  `json:"title"`
		Artist     string  `json:"artist"`
		Album      string  `json:"album"`
		Track      string  `json:"track"`
		Year       string  `json:"upload_date"`
		Genre      string  `json:"genre"`
		Channel    string  `json:"channel"`
		Uploader   string  `json:"uploader"`
		Creator    string  `json:"creator"`
		WebpageURL string  `json:"webpage_url"`
		Thumbnail  string  `json:"thumbnail"`
		Duration   float64 `json:"duration"`
		Extractor  string  `json:"extractor"`
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	lastLine := lines[len(lines)-1]
	if err := json.Unmarshal([]byte(lastLine), &info); err != nil {
		http.Error(w, `{"error":"could not parse video info"}`, http.StatusInternalServerError)
		return
	}

	artist := info.Artist
	if artist == "" {
		artist = info.Creator
	}
	if artist == "" {
		artist = info.Uploader
	}
	if artist == "" {
		artist = info.Channel
	}

	artist = cleanChannelArtist(artist)

	title := info.Title
	artist, title = parseVideoTitle(title, artist)

	response := map[string]interface{}{
		"title":      title,
		"artist":     artist,
		"album":      info.Album,
		"year":       info.Year,
		"genre":      info.Genre,
		"source":     "youtube",
		"url":        req.URL,
		"coverUrl":   info.Thumbnail,
		"confidence": 0,
	}

	if title != "" && artist != "" {
		go func() {
			results, err := musicbrainz.MbSearchRecordings(artist, title, 5)
			if err == nil && len(results) > 0 {
				best := results[0]
				score := scoreMatchV2(best.Title, best.Artist, artist, title)
				if score > 60 {
					log.Printf("[v2-resolve] MusicBrainz match: %s - %s (score %.0f)", best.Artist, best.Title, score)
				}
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func parseVideoTitle(title, channel string) (string, string) {
	original := title

	replacements := []string{
		"(Official Music Video)", "(Official Video)", "(Official Audio)",
		"(Official HD Video)", "(Official)", "[Official Video]", "[Official Audio]",
		"(Music Video)", "[Music Video]", "(HD)", "[HD]", "(HQ)", "[HQ]",
		"(Lyric Video)", "(Lyrics)", "[Lyrics]", "(Audio)", "[Audio]",
		"(Visualizer)", "[Visualizer]", "(Animated Video)",
		" - Official Music Video", " - Official Video", " - Official Audio",
		" | Official Music Video", " | Official Video",
		"(Official Lyric Video)", "(Official Visualiser)", "[Official Lyric Video]",
		"(Official Visualiser)", "(Official Lyric Visualizer)",
		"(Color Coded Lyrics)", "(CC Lyrics)",
		"【Official Music Video】", "【Official Video】", "【Official Audio】",
		"『Official Music Video』",
	}

	for _, suffix := range replacements {
		re := strings.NewReplacer(
			suffix, "",
			strings.ToLower(suffix), "",
			strings.ToUpper(suffix), "",
		)
		title = re.Replace(title)
	}

	title = strings.ReplaceAll(title, "  ", " ")
	title = strings.TrimSpace(title)

	if strings.Contains(original, " - ") {
		parts := strings.SplitN(original, " - ", 2)
		if len(parts) == 2 {
			left := strings.TrimSpace(parts[0])
			right := strings.TrimSpace(parts[1])
			for _, suffix := range replacements {
				right = strings.ReplaceAll(right, suffix, "")
			}
			right = strings.TrimSpace(right)
			if left != "" && right != "" {
				return left, right
			}
		}
	}

	if strings.Contains(original, " – ") {
		parts := strings.SplitN(original, " – ", 2)
		if len(parts) == 2 {
			left := strings.TrimSpace(parts[0])
			right := strings.TrimSpace(parts[1])
			for _, suffix := range replacements {
				right = strings.ReplaceAll(right, suffix, "")
			}
			right = strings.TrimSpace(right)
			if left != "" && right != "" {
				return left, right
			}
		}
	}

	if channel != "" {
		return cleanChannelArtist(channel), title
	}

	return channel, title
}

func cleanChannelArtist(artist string) string {
	artist = strings.TrimSpace(artist)
	artist = strings.TrimSuffix(artist, " - Topic")
	artist = strings.TrimSuffix(artist, " Topic")
	artist = strings.TrimSuffix(artist, "VEVO")
	for _, suffix := range []string{"VEVO", " - Topic", " Topic", " Official", " Music"} {
		if strings.HasSuffix(artist, suffix) {
			artist = strings.TrimSuffix(artist, suffix)
		}
	}
	lower := strings.ToLower(artist)
	generic := []string{"music", "songs", "lyrics", "vevo", "official", "topic", "various", "unknown"}
	for _, g := range generic {
		if lower == g {
			return ""
		}
	}
	return strings.TrimSpace(artist)
}

func scoreMatchV2(mbTitle, mbArtist, expectedArtist, expectedTitle string) float64 {
	score := 0.0
	mbt := strings.ToLower(mbTitle)
	mba := strings.ToLower(mbArtist)
	a := strings.ToLower(expectedArtist)
	t := strings.ToLower(expectedTitle)

	if a != "" && strings.Contains(mba, a) {
		score += 60
	}
	if t != "" && strings.Contains(mbt, t) {
		score += 50
	}
	if a != "" && downloads.LevenshteinContains(mbt, a) {
		score += 30
	}
	if t != "" && downloads.LevenshteinContains(mba, t) {
		score += 20
	}

	return score
}

func findPython3() string {
	for _, p := range []string{"python3", "/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"} {
		if path, err := exec.LookPath(p); err == nil {
			return path
		}
	}
	return ""
}

func EnrichWithPython(audioFile string, job *downloads.DownloadJob) {
	pythonPath := findPython3()
	if pythonPath == "" {
		log.Printf("[v2-enrich] python3 not found, skipping enrichment")
		downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
		return
	}

	scriptPath := "scripts/enrich.py"
	if _, err := os.Stat(scriptPath); err != nil {
		candidates := []string{}
		if exe, _ := os.Executable(); exe != "" {
			candidates = append(candidates, filepath.Join(filepath.Dir(exe), "scripts", "enrich.py"))
		}
		found := false
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				scriptPath = p
				found = true
				break
			}
		}
		if !found {
			log.Printf("[v2-enrich] scripts/enrich.py not found, falling back to ffmpeg tagging")
			downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
			return
		}
	}

	meta := map[string]string{
		"artist":       job.Artist,
		"title":        job.Title,
		"album":        job.Album,
		"album_artist": job.Artist,
	}
	if job.Year != "" {
		meta["year"] = job.Year
	}
	if job.TrackNumber > 0 {
		meta["track_number"] = fmt.Sprintf("%d", job.TrackNumber)
	}
	if job.Genre != "" {
		meta["genre"] = job.Genre
	}
	if job.RecordingID != "" {
		meta["recording_id"] = job.RecordingID
	}
	if job.ArtistID != "" {
		meta["artist_id"] = job.ArtistID
	}
	if job.ReleaseID != "" {
		meta["release_id"] = job.ReleaseID
	}

	metaJSON, _ := json.Marshal(meta)

	cmd := exec.Command(pythonPath, scriptPath, "enrich", audioFile, string(metaJSON))
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[v2-enrich] Python enrich failed: %v — %s", err, string(output))
		downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err == nil {
		log.Printf("[v2-enrich] Enrichment result: %s", string(output))
	} else {
		log.Printf("[v2-enrich] Could not parse enrich output: %s", string(output))
	}
}

func V2SearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Artist string `json:"artist"`
		Title  string `json:"title"`
		Raw    string `json:"raw"`
		Limit  int    `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	pythonPath := findPython3()
	if pythonPath == "" {
		http.Error(w, `{"error":"python3 not found"}`, http.StatusInternalServerError)
		return
	}

	scriptPath := "scripts/enrich.py"
	if _, err := os.Stat(scriptPath); err != nil {
		http.Error(w, `{"error":"enrich.py not found"}`, http.StatusInternalServerError)
		return
	}

	var cmd *exec.Cmd
	if req.Raw != "" {
		cmd = exec.Command(pythonPath, scriptPath, "search", req.Raw)
	} else if req.Artist != "" && req.Title != "" {
		limit := req.Limit
		if limit <= 0 {
			limit = 5
		}
		cmd = exec.Command(pythonPath, scriptPath, "search-mb", req.Artist, req.Title, fmt.Sprintf("%d", limit))
	} else {
		http.Error(w, `{"error":"raw or artist+title required"}`, http.StatusBadRequest)
		return
	}

	output, err := cmd.Output()
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		errMsg := err.Error()
		if ok {
			errMsg = string(exitErr.Stderr)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "search failed: " + errMsg})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(output)
}

func V2LyricsHandler(w http.ResponseWriter, r *http.Request) {
	artist := r.URL.Query().Get("artist")
	title := r.URL.Query().Get("title")
	if artist == "" || title == "" {
		http.Error(w, `{"error":"artist and title required"}`, http.StatusBadRequest)
		return
	}

	pythonPath := findPython3()
	if pythonPath == "" {
		http.Error(w, `{"error":"python3 not found"}`, http.StatusInternalServerError)
		return
	}

	cmd := exec.Command(pythonPath, "scripts/enrich.py", "lyrics", artist, title)
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, `{"found":false}`, http.StatusOK)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(output)
}
