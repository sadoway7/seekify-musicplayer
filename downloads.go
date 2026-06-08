package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type DownloadJob struct {
	ID             string `json:"id"`
	Query          string `json:"query"`
	Artist         string `json:"artist"`
	Title          string `json:"title"`
	Album          string `json:"album,omitempty"`
	AlbumMBID      string `json:"albumMbid,omitempty"`
	TrackNumber    int    `json:"trackNumber,omitempty"`
	TrackTotal     int    `json:"trackTotal,omitempty"`
	Status         string `json:"status"`
	Error          string `json:"error,omitempty"`
	Source         string `json:"source,omitempty"`
	AudioQuality   string `json:"audioQuality,omitempty"`
	FileDeleted    bool   `json:"fileDeleted"`
	ProgressStage  string `json:"progressStage,omitempty"`
	OverrideDir    string `json:"overrideDir,omitempty"`
	SearchQuery    string `json:"searchQuery,omitempty"`
	CreatedAt      string `json:"createdAt"`
	CompletedAt    string `json:"completedAt,omitempty"`
}

var (
	downloadMu     sync.Mutex
	downloadSem    = make(chan struct{}, 3)
	downloadActive bool
)

func initDownloadTables() {
	db.Exec(`CREATE TABLE IF NOT EXISTS download_jobs (
		id TEXT PRIMARY KEY,
		query TEXT NOT NULL DEFAULT '',
		artist TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		album TEXT NOT NULL DEFAULT '',
		album_mbid TEXT NOT NULL DEFAULT '',
		track_number INTEGER NOT NULL DEFAULT 0,
		track_total INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'queued',
		error TEXT NOT NULL DEFAULT '',
		source TEXT NOT NULL DEFAULT '',
		audio_quality TEXT NOT NULL DEFAULT '',
		file_deleted INTEGER NOT NULL DEFAULT 0,
		progress_stage TEXT NOT NULL DEFAULT '',
		override_dir TEXT NOT NULL DEFAULT '',
		search_query TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		completed_at TEXT NOT NULL DEFAULT ''
	)`)
}

func dbCreateJob(job *DownloadJob) error {
	_, err := db.Exec(`INSERT INTO download_jobs
		(id, query, artist, title, album, album_mbid, track_number, track_total,
		 status, error, source, audio_quality, file_deleted, progress_stage,
		 override_dir, search_query, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Query, job.Artist, job.Title, job.Album, job.AlbumMBID,
		job.TrackNumber, job.TrackTotal, job.Status, job.Error, job.Source,
		job.AudioQuality, boolToInt(job.FileDeleted), job.ProgressStage,
		job.OverrideDir, job.SearchQuery, job.CreatedAt, job.CompletedAt)
	return err
}

func dbUpdateJob(job *DownloadJob) error {
	_, err := db.Exec(`UPDATE download_jobs SET
		status = ?, error = ?, source = ?, audio_quality = ?,
		file_deleted = ?, progress_stage = ?, completed_at = ?
		WHERE id = ?`,
		job.Status, job.Error, job.Source, job.AudioQuality,
		boolToInt(job.FileDeleted), job.ProgressStage, job.CompletedAt,
		job.ID)
	return err
}

func dbGetJob(id string) (*DownloadJob, error) {
	row := db.QueryRow(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_deleted, progress_stage,
		override_dir, search_query, created_at, completed_at
		FROM download_jobs WHERE id = ?`, id)
	return scanJob(row)
}

func dbGetJobs(limit int) ([]DownloadJob, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_deleted, progress_stage,
		override_dir, search_query, created_at, completed_at
		FROM download_jobs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var jobs []DownloadJob
	for rows.Next() {
		var j DownloadJob
		var fileDeleted int
		err := rows.Scan(&j.ID, &j.Query, &j.Artist, &j.Title, &j.Album,
			&j.AlbumMBID, &j.TrackNumber, &j.TrackTotal,
			&j.Status, &j.Error, &j.Source, &j.AudioQuality,
			&fileDeleted, &j.ProgressStage,
			&j.OverrideDir, &j.SearchQuery, &j.CreatedAt, &j.CompletedAt)
		if err != nil {
			continue
		}
		j.FileDeleted = fileDeleted == 1
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func dbGetQueuedJobs() ([]DownloadJob, error) {
	rows, err := db.Query(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_deleted, progress_stage,
		override_dir, search_query, created_at, completed_at
		FROM download_jobs WHERE status = 'queued' ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var jobs []DownloadJob
	for rows.Next() {
		var j DownloadJob
		var fileDeleted int
		err := rows.Scan(&j.ID, &j.Query, &j.Artist, &j.Title, &j.Album,
			&j.AlbumMBID, &j.TrackNumber, &j.TrackTotal,
			&j.Status, &j.Error, &j.Source, &j.AudioQuality,
			&fileDeleted, &j.ProgressStage,
			&j.OverrideDir, &j.SearchQuery, &j.CreatedAt, &j.CompletedAt)
		if err != nil {
			continue
		}
		j.FileDeleted = fileDeleted == 1
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func scanJob(row *sql.Row) (*DownloadJob, error) {
	var j DownloadJob
	var fileDeleted int
	err := row.Scan(&j.ID, &j.Query, &j.Artist, &j.Title, &j.Album,
		&j.AlbumMBID, &j.TrackNumber, &j.TrackTotal,
		&j.Status, &j.Error, &j.Source, &j.AudioQuality,
		&fileDeleted, &j.ProgressStage,
		&j.OverrideDir, &j.SearchQuery, &j.CreatedAt, &j.CompletedAt)
	if err != nil {
		return nil, err
	}
	j.FileDeleted = fileDeleted == 1
	return &j, nil
}

func createDownloadJob(query, artist, title, album, albumMBID string, trackNum, trackTotal int, overrideDir string) (*DownloadJob, error) {
	id := uuid.New().String()[:8]
	searchQuery := query
	if searchQuery == "" && (artist != "" || title != "") {
		parts := []string{}
		if artist != "" {
			parts = append(parts, artist)
		}
		if title != "" {
			parts = append(parts, title)
		}
		searchQuery = strings.Join(parts, " - ")
	}

	job := &DownloadJob{
		ID:          id,
		Query:       query,
		Artist:      artist,
		Title:       title,
		Album:       album,
		AlbumMBID:   albumMBID,
		TrackNumber: trackNum,
		TrackTotal:  trackTotal,
		Status:      "queued",
		OverrideDir: overrideDir,
		SearchQuery: searchQuery,
		CreatedAt:   time.Now().Format(time.RFC3339),
	}

	if err := dbCreateJob(job); err != nil {
		return nil, err
	}

	go processDownloadQueue()
	return job, nil
}

func processDownloadQueue() {
	downloadMu.Lock()
	if downloadActive {
		downloadMu.Unlock()
		return
	}
	downloadActive = true
	downloadMu.Unlock()

	defer func() {
		downloadMu.Lock()
		downloadActive = false
		downloadMu.Unlock()
	}()

	for {
		jobs, err := dbGetQueuedJobs()
		if err != nil || len(jobs) == 0 {
			return
		}

		job := &jobs[0]
		downloadSem <- struct{}{}
		processSingleDownload(job)
		<-downloadSem

		time.Sleep(500 * time.Millisecond)
	}
}

func processSingleDownload(job *DownloadJob) {
	job.Status = "searching"
	job.ProgressStage = "Searching for: " + job.SearchQuery
	dbUpdateJob(job)

	videoID, source, err := searchYouTube(job.SearchQuery, job.Artist)
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("Search failed: %v", err)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		log.Printf("[download] Search failed for %q: %v", job.SearchQuery, err)
		return
	}

	job.Status = "downloading"
	job.Source = source
	job.ProgressStage = "Downloading audio"
	dbUpdateJob(job)

	destDir := musicDir
	if job.OverrideDir != "" {
		destDir = job.OverrideDir
	} else {
		safeArtist := sanitizeFilename(job.Artist)
		if safeArtist != "" {
			destDir = filepath.Join(musicDir, safeArtist)
		}
	}
	os.MkdirAll(destDir, 0755)

	outputTemplate := filepath.Join(destDir, "%(title)s.%(ext)s")

	ytdlpPath, _ := exec.LookPath("yt-dlp")
	if ytdlpPath == "" {
		job.Status = "failed"
		job.Error = "yt-dlp not installed. Install with: brew install yt-dlp"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		return
	}

	url := fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID)
	cmd := exec.Command(ytdlpPath,
		"-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
		"-x",
		"--audio-format", "flac",
		"--audio-quality", "0",
		"--embed-metadata",
		"--embed-thumbnail",
		"--convert-thumbnails", "jpg",
		"--no-warnings",
		"-o", outputTemplate,
		url,
	)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("yt-dlp failed: %v", err)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		log.Printf("[download] yt-dlp failed for %q: %v", job.SearchQuery, err)
		return
	}

	audioFile := findDownloadedFile(destDir, job.Title)
	if audioFile == "" {
		job.Status = "failed"
		job.Error = "Download completed but audio file not found"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		return
	}

	if job.Artist != "" || job.Title != "" {
		newName := buildTrackFilename(job.Artist, job.Title, filepath.Ext(audioFile))
		newPath := filepath.Join(destDir, newName)
		if newPath != audioFile {
			os.Rename(audioFile, newPath)
			audioFile = newPath
		}
	}

	quality := probeAudioQuality(audioFile)

	job.Status = "completed"
	job.AudioQuality = quality
	job.ProgressStage = "Done"
	job.CompletedAt = time.Now().Format(time.RFC3339)
	dbUpdateJob(job)

	log.Printf("[download] Completed: %s - %s -> %s (quality: %s)", job.Artist, job.Title, audioFile, quality)

	go func() {
		time.Sleep(1 * time.Second)
		scanMusicDir(musicDir)
	}()
}

func searchYouTube(query, expectedArtist string) (string, string, error) {
	ytdlpPath, err := exec.LookPath("yt-dlp")
	if err != nil {
		return "", "", fmt.Errorf("yt-dlp not found: %w", err)
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytsearch5:%s", query),
	)
	output, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("yt-dlp search failed: %w", err)
	}

	type SearchResult struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Channel  string `json:"channel"`
		Duration int    `json:"duration"`
	}

	var results []SearchResult
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var r SearchResult
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			continue
		}
		if r.ID != "" && r.Duration > 0 {
			results = append(results, r)
		}
	}

	if len(results) == 0 {
		return "", "", fmt.Errorf("no results found on YouTube")
	}

	best := results[0]
	bestScore := scoreSearchResult(best.Title, best.Channel, expectedArtist)
	for _, r := range results[1:] {
		s := scoreSearchResult(r.Title, r.Channel, expectedArtist)
		if s > bestScore {
			best = r
			bestScore = s
		}
	}

	return best.ID, "youtube", nil
}

func scoreSearchResult(title, channel, expectedArtist string) float64 {
	score := 0.0
	t := strings.ToLower(title)
	c := strings.ToLower(channel)
	a := strings.ToLower(expectedArtist)

	if a != "" && strings.Contains(c, a) {
		score += 50
	}
	if a != "" && strings.Contains(t, a) {
		score += 30
	}

	lowerWords := []string{"karaoke", "instrumental", "cover", "tutorial",
		"reaction", "review", "remix by", "mashup", "parody"}
	for _, w := range lowerWords {
		if strings.Contains(t, w) {
			score -= 40
		}
	}

	upperWords := []string{"official", "audio", "music video", "lyric"}
	for _, w := range upperWords {
		if strings.Contains(t, w) {
			score += 10
		}
	}

	duration := 0
	if idx := strings.Index(t, "["); idx > 0 {
		part := t[idx:]
		re := regexp.MustCompile(`(\d+):(\d+)`)
		if m := re.FindStringSubmatch(part); len(m) == 3 {
			mins, _ := strconv.Atoi(m[1])
			secs, _ := strconv.Atoi(m[2])
			duration = mins*60 + secs
		}
	}
	_ = duration

	return score
}

func findDownloadedFile(dir, expectedTitle string) string {
	extensions := []string{".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	expectedLower := strings.ToLower(expectedTitle)

	var bestMatch string
	bestScore := -1

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		found := false
		for _, supported := range extensions {
			if ext == supported {
				found = true
				break
			}
		}
		if !found {
			continue
		}

		info, err := e.Info()
		if err != nil || info.Size() == 0 {
			continue
		}

		nameLower := strings.ToLower(e.Name())
		if expectedLower != "" && strings.Contains(nameLower, expectedLower) {
			return filepath.Join(dir, e.Name())
		}

		score := 0
		if strings.Contains(nameLower, "flac") {
			score += 5
		}
		if score > bestScore {
			bestScore = score
			bestMatch = filepath.Join(dir, e.Name())
		}
	}

	if bestMatch == "" && len(entries) > 0 {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			for _, supported := range extensions {
				if ext == supported {
					info, err := e.Info()
					if err == nil && info.Size() > 0 {
						return filepath.Join(dir, e.Name())
					}
				}
			}
		}
	}

	return bestMatch
}

func buildTrackFilename(artist, title, ext string) string {
	safeTitle := sanitizeFilename(title)
	if safeTitle == "" {
		safeTitle = "Untitled"
	}
	return safeTitle + ext
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, ch := range invalid {
		name = strings.ReplaceAll(name, ch, "_")
	}
	name = strings.TrimSpace(name)
	for strings.HasSuffix(name, ".") {
		name = name[:len(name)-1]
	}
	return name
}

func probeAudioQuality(filePath string) string {
	ffprobePath, _ := exec.LookPath("ffprobe")
	if ffprobePath == "" {
		return ""
	}

	cmd := exec.Command(ffprobePath,
		"-v", "quiet",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name,bit_rate,sample_rate",
		"-of", "json",
		filePath,
	)
	output, err := cmd.Output()
	if err != nil {
		return ""
	}

	var info struct {
		Streams []struct {
			CodecName  string `json:"codec_name"`
			BitRate    string `json:"bit_rate"`
			SampleRate string `json:"sample_rate"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &info); err != nil || len(info.Streams) == 0 {
		return ""
	}

	s := info.Streams[0]
	codec := strings.ToUpper(s.CodecName)
	bitRate, _ := strconv.Atoi(s.BitRate)
	sampleRate, _ := strconv.Atoi(s.SampleRate)

	if codec == "FLAC" {
		parts := []string{"FLAC"}
		if sampleRate > 0 {
			parts = append(parts, fmt.Sprintf("%.1fkHz", float64(sampleRate)/1000))
		}
		return strings.Join(parts, " ")
	}

	if bitRate > 0 {
		return fmt.Sprintf("%s %dkbps", codec, bitRate/1000)
	}
	return codec
}

func downloadFile(filePath string, w http.ResponseWriter, r *http.Request) {
	f, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer f.Close()

	stat, _ := f.Stat()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(filePath)))
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	io.Copy(w, f)
}
