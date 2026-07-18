package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"musicapp/internal/downloads"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func RipperV2Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
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

	parsedURL, err := url.Parse(req.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		http.Error(w, `{"error":"Only HTTP(S) URLs are supported"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath := downloads.FindYtDlp()
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not found"}`, http.StatusInternalServerError)
		return
	}

	ytDlpSem <- struct{}{}
	defer func() { <-ytDlpSem }()

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		req.URL,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	output, err := cmd.Output()
	if err != nil {
		cmd := exec.CommandContext(ctx, ytdlpPath,
			append(downloads.YtCommonArgs(),
				"--dump-json",
				"--no-warnings",
				"--no-download",
				req.URL,
			)...)
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		output, err = cmd.Output()
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "yt-dlp failed: "+string(output))
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
	if len(lines) == 0 {
		writeJSONError(w, http.StatusBadGateway, "yt-dlp returned no metadata")
		return
	}
	lastLine := lines[len(lines)-1]
	if strings.TrimSpace(lastLine) == "" {
		writeJSONError(w, http.StatusBadGateway, "yt-dlp returned no metadata")
		return
	}
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

	writeJSON(w, response)
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
		cleaned := cleanChannelArtist(channel)
		if cleaned == "" {
			cleaned = strings.TrimSpace(channel)
		}
		return cleaned, title
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "enrich", audioFile, string(metaJSON))
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
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if req.Raw != "" {
		cmd = exec.CommandContext(ctx, pythonPath, scriptPath, "search", req.Raw)
	} else if req.Artist != "" && req.Title != "" {
		limit := req.Limit
		if limit <= 0 {
			limit = 5
		}
		cmd = exec.CommandContext(ctx, pythonPath, scriptPath, "search-mb", req.Artist, req.Title, fmt.Sprintf("%d", limit))
	} else {
		http.Error(w, `{"error":"raw or artist+title required"}`, http.StatusBadRequest)
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	output, err := cmd.Output()
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		errMsg := err.Error()
		if ok {
		errMsg = string(exitErr.Stderr)
	}
	writeJSONError(w, http.StatusInternalServerError, "search failed: "+errMsg)
	return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(output)
}
