package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
	FilePath       string `json:"filePath,omitempty"`
	FileDeleted    bool   `json:"fileDeleted"`
	ProgressStage  string `json:"progressStage,omitempty"`
	OverrideDir    string `json:"overrideDir,omitempty"`
	SearchQuery    string `json:"searchQuery,omitempty"`
	ConvertToFlac  bool   `json:"convertToFlac"`
	PlaylistID     string `json:"playlistId,omitempty"`
	VideoID        string `json:"videoId,omitempty"`
	CreatedAt      string `json:"createdAt"`
	CompletedAt    string `json:"completedAt,omitempty"`
	Pipeline       string `json:"pipeline,omitempty"`
	RecordingID    string `json:"recordingId,omitempty"`
	ReleaseID      string `json:"releaseId,omitempty"`
	ArtistID       string `json:"artistId,omitempty"`
	Genre          string `json:"genre,omitempty"`
	Year           string `json:"year,omitempty"`
	CandidatesJSON string `json:"candidates,omitempty"`
}

var (
	downloadMu     sync.Mutex
	downloadActive int
	downloadSem    = make(chan struct{}, 3)
	activeJobs     = make(map[string]*exec.Cmd)
	activeJobTime  = make(map[string]time.Time)
)

const downloadTimeout = 10 * time.Minute
const searchTimeout = 2 * time.Minute

func findYtDlp() string {
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p
	}
	for _, p := range []string{
		"/opt/homebrew/bin/yt-dlp",
		"/usr/local/bin/yt-dlp",
		"/usr/bin/yt-dlp",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func findFfmpeg() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	for _, p := range []string{
		"/opt/homebrew/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/usr/bin/ffmpeg",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func findFfprobe() string {
	if p, err := exec.LookPath("ffprobe"); err == nil {
		return p
	}
	for _, p := range []string{
		"/opt/homebrew/bin/ffprobe",
		"/usr/local/bin/ffprobe",
		"/usr/bin/ffprobe",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

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
		file_path TEXT NOT NULL DEFAULT '',
		file_deleted INTEGER NOT NULL DEFAULT 0,
		progress_stage TEXT NOT NULL DEFAULT '',
		override_dir TEXT NOT NULL DEFAULT '',
		search_query TEXT NOT NULL DEFAULT '',
		convert_to_flac INTEGER NOT NULL DEFAULT 1,
		playlist_id TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		completed_at TEXT NOT NULL DEFAULT ''
	)`)

	migrations := []string{
		`ALTER TABLE download_jobs ADD COLUMN file_path TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN file_deleted INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE download_jobs ADD COLUMN progress_stage TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN override_dir TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN search_query TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN convert_to_flac INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE download_jobs ADD COLUMN audio_quality TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN source TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN album_mbid TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN track_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE download_jobs ADD COLUMN track_total INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE download_jobs ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN playlist_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN video_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN pipeline TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN recording_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN release_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN artist_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN genre TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN year TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE download_jobs ADD COLUMN candidates TEXT NOT NULL DEFAULT ''`,
	}
	for _, m := range migrations {
		db.Exec(m)
	}
}

func dbCreateJob(job *DownloadJob) error {
	_, err := db.Exec(`INSERT INTO download_jobs
		(id, query, artist, title, album, album_mbid, track_number, track_total,
		 status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		 override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Query, job.Artist, job.Title, job.Album, job.AlbumMBID,
		job.TrackNumber, job.TrackTotal, job.Status, job.Error, job.Source,
		job.AudioQuality, job.FilePath, boolToInt(job.FileDeleted), job.ProgressStage,
		job.OverrideDir, job.SearchQuery, boolToInt(job.ConvertToFlac), job.PlaylistID, job.VideoID, job.CreatedAt, job.CompletedAt)
	return err
}

func dbUpdateJob(job *DownloadJob) error {
	_, err := db.Exec(`UPDATE download_jobs SET
		status = ?, error = ?, source = ?, audio_quality = ?,
		file_path = ?, file_deleted = ?, progress_stage = ?, completed_at = ?,
		pipeline = ?, recording_id = ?, release_id = ?, artist_id = ?, genre = ?, year = ?,
		candidates = ?, video_id = ?
		WHERE id = ?`,
		job.Status, job.Error, job.Source, job.AudioQuality,
		job.FilePath, boolToInt(job.FileDeleted), job.ProgressStage, job.CompletedAt,
		job.Pipeline, job.RecordingID, job.ReleaseID, job.ArtistID, job.Genre, job.Year,
		job.CandidatesJSON, job.VideoID,
		job.ID)
	return err
}

func dbGetJob(id string) (*DownloadJob, error) {
	row := db.QueryRow(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs WHERE id = ?`, id)
	return scanJob(row)
}

func dbGetJobs(limit int) ([]DownloadJob, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs ORDER BY
			CASE status
				WHEN 'searching' THEN 0
				WHEN 'downloading' THEN 1
				WHEN 'tagging' THEN 2
				WHEN 'needs_selection' THEN 3
				WHEN 'completed' THEN 4
				WHEN 'queued' THEN 5
				ELSE 6
			END,
			completed_at DESC,
			created_at DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobs(rows)
}

func dbGetQueuedJobs() ([]DownloadJob, error) {
	rows, err := db.Query(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs WHERE status = 'queued' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobs(rows)
}

func dbGetJobCounts() map[string]int {
	counts := map[string]int{"queued": 0, "searching": 0, "downloading": 0, "tagging": 0, "completed": 0, "failed": 0, "needs_selection": 0}
	rows, err := db.Query("SELECT status, COUNT(*) FROM download_jobs GROUP BY status")
	if err != nil {
		return counts
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if rows.Scan(&status, &count) == nil {
			counts[status] = count
		}
	}
	return counts
}

func scanJob(row *sql.Row) (*DownloadJob, error) {
	var j DownloadJob
	var fileDeleted, convertFlac int
	err := row.Scan(&j.ID, &j.Query, &j.Artist, &j.Title, &j.Album,
		&j.AlbumMBID, &j.TrackNumber, &j.TrackTotal,
		&j.Status, &j.Error, &j.Source, &j.AudioQuality,
		&j.FilePath, &fileDeleted, &j.ProgressStage,
		&j.OverrideDir, &j.SearchQuery, &convertFlac,
		&j.PlaylistID, &j.VideoID, &j.CreatedAt, &j.CompletedAt,
		&j.Pipeline, &j.RecordingID, &j.ReleaseID, &j.ArtistID, &j.Genre, &j.Year, &j.CandidatesJSON)
	if err != nil {
		return nil, err
	}
	j.FileDeleted = fileDeleted == 1
	j.ConvertToFlac = convertFlac == 1
	return &j, nil
}

func scanJobs(rows *sql.Rows) ([]DownloadJob, error) {
	var jobs []DownloadJob
	for rows.Next() {
		var j DownloadJob
		var fileDeleted, convertFlac int
		err := rows.Scan(&j.ID, &j.Query, &j.Artist, &j.Title, &j.Album,
			&j.AlbumMBID, &j.TrackNumber, &j.TrackTotal,
			&j.Status, &j.Error, &j.Source, &j.AudioQuality,
			&j.FilePath, &fileDeleted, &j.ProgressStage,
			&j.OverrideDir, &j.SearchQuery, &convertFlac,
			&j.PlaylistID, &j.VideoID, &j.CreatedAt, &j.CompletedAt,
			&j.Pipeline, &j.RecordingID, &j.ReleaseID, &j.ArtistID, &j.Genre, &j.Year, &j.CandidatesJSON)
		if err != nil {
			continue
		}
		j.FileDeleted = fileDeleted == 1
		j.ConvertToFlac = convertFlac == 1
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func createDownloadJob(query, artist, title, album, albumMBID string, trackNum, trackTotal int, overrideDir, videoID string) (*DownloadJob, error) {
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
		if album != "" {
			parts = append(parts, album)
		}
		searchQuery = strings.Join(parts, " - ")
	}

	mu.RLock()
	existing := tracks
	mu.RUnlock()
	if artist != "" && title != "" {
		for _, t := range existing {
			if strings.EqualFold(t.Artist, artist) && strings.EqualFold(t.Title, title) {
				return nil, fmt.Errorf("already in library")
			}
		}
	}

	job := &DownloadJob{
		ID:            id,
		Query:         query,
		Artist:        artist,
		Title:         title,
		Album:         album,
		AlbumMBID:     albumMBID,
		TrackNumber:   trackNum,
		TrackTotal:    trackTotal,
		Status:        "queued",
		OverrideDir:   overrideDir,
		SearchQuery:   searchQuery,
		ConvertToFlac: true,
		VideoID:       videoID,
		CreatedAt:     time.Now().Format(time.RFC3339),
	}

	if err := dbCreateJob(job); err != nil {
		return nil, err
	}

	go processDownloadQueue()
	return job, nil
}

func processDownloadQueue() {
	downloadMu.Lock()
	if downloadActive >= cap(downloadSem) {
		downloadMu.Unlock()
		return
	}
	downloadActive++
	downloadMu.Unlock()

	defer func() {
		downloadMu.Lock()
		downloadActive--
		downloadMu.Unlock()
	}()

	for {
		jobs, err := dbGetQueuedJobs()
		if err != nil || len(jobs) == 0 {
			return
		}

		downloadMu.Lock()
		if downloadActive > cap(downloadSem) {
			downloadMu.Unlock()
			return
		}
		downloadMu.Unlock()

		job := &jobs[0]
		downloadSem <- struct{}{}
		processSingleDownload(job)
		<-downloadSem

		time.Sleep(500 * time.Millisecond)
	}
}

func processSingleDownload(job *DownloadJob) {
	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		job.Status = "failed"
		job.Error = "yt-dlp not found. Install with: pip install yt-dlp  OR  apt install yt-dlp  OR  apk add yt-dlp"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		log.Printf("[download] yt-dlp not found on PATH or known locations")
		return
	}
	log.Printf("[download] using yt-dlp at %s", ytdlpPath)

	job.Status = "searching"
	job.ProgressStage = "Searching YouTube"
	dbUpdateJob(job)

	var videoID string
	if job.VideoID != "" {
		videoID = job.VideoID
		log.Printf("[download] Using direct video ID %s for %q", videoID, job.SearchQuery)
	} else {
		candidates, serr := searchYouTubeWithTimeout(job.SearchQuery, job.Artist, job.Title, searchTimeout)
		if serr != nil {
			job.Status = "failed"
			job.Error = fmt.Sprintf("Search failed: %v", serr)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			dbUpdateJob(job)
			log.Printf("[download] Search failed for %q: %v", job.SearchQuery, serr)
			return
		}
		if len(candidates) == 0 {
			job.Status = "failed"
			job.Error = "No results found on YouTube"
			job.CompletedAt = time.Now().Format(time.RFC3339)
			dbUpdateJob(job)
			return
		}

		const minConfidence = 40.0
		if candidates[0].Score < minConfidence {
			max := len(candidates)
			if max > 8 {
				max = 8
			}
			toSave := candidates[:max]
			candJSON, _ := json.Marshal(toSave)
			job.CandidatesJSON = string(candJSON)
			job.Status = "needs_selection"
			job.ProgressStage = "Awaiting user selection"
			dbUpdateJob(job)
			log.Printf("[download] Low confidence (%.1f) for %q, waiting for user selection", candidates[0].Score, job.SearchQuery)
			return
		}

		videoID = candidates[0].VideoID
		log.Printf("[download] Auto-selected %s (score %.1f) for %q", videoID, candidates[0].Score, job.SearchQuery)
	}

	destDir := musicDir
	organise := getSettingBool("download_organise_by_artist", true)
	albumSubdir := getSetting("download_album_subdir", "Albums")
	if albumSubdir == "" {
		albumSubdir = "Albums"
	}

	if job.OverrideDir != "" {
		destDir = job.OverrideDir
	} else if job.Album != "" && job.Artist != "" {
		destDir = filepath.Join(musicDir, sanitizeFilename(job.Artist), sanitizeFilename(job.Album))
	} else if job.Artist != "" && organise {
		destDir = filepath.Join(musicDir, sanitizeFilename(job.Artist))
	} else {
		destDir = musicDir
	}
	os.MkdirAll(destDir, 0755)

	job.Status = "downloading"
	job.Source = "youtube"
	job.ProgressStage = "Downloading audio"
	dbUpdateJob(job)

	safeTitle := sanitizeFilename(job.Title)
	if safeTitle == "" {
		safeTitle = sanitizeFilename(job.SearchQuery)
	}
	if safeTitle == "" {
		safeTitle = "track"
	}
	outputTemplate := filepath.Join(destDir, safeTitle+".%(ext)s")

	url := fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID)

	audioFormat := getSetting("download_format", "flac")
	audioQuality := "0"
	switch audioFormat {
	case "mp3":
		audioQuality = getSetting("mp3_bitrate", "v2")
	case "opus":
		audioQuality = getSetting("opus_bitrate", "320k")
	case "best", "m4a":
		audioFormat = "best"
		audioQuality = "0"
	default:
		audioFormat = "flac"
	}

	if !getSettingBool("download_convert_to_flac", true) {
		audioFormat = "best"
	}

	ytArgs := []string{
		"-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
		"-x",
		"--audio-format", audioFormat,
		"--audio-quality", audioQuality,
		"--embed-metadata",
		"--embed-thumbnail",
		"--convert-thumbnails", "jpg",
		"--no-warnings",
		"-o", outputTemplate,
		url,
	}

	minBr := getSettingInt("download_min_bitrate", 0)

	cmd := exec.Command(ytdlpPath, ytArgs...)

	downloadMu.Lock()
	activeJobs[job.ID] = cmd
	activeJobTime[job.ID] = time.Now()
	downloadMu.Unlock()

	defer func() {
		downloadMu.Lock()
		delete(activeJobs, job.ID)
		delete(activeJobTime, job.ID)
		downloadMu.Unlock()
	}()

	done := make(chan struct{})
	var output []byte
	var cmdErr error
	go func() {
		output, cmdErr = cmd.CombinedOutput()
		close(done)
	}()

	select {
	case <-done:
		if cmdErr != nil {
			job.Status = "failed"
			job.Error = fmt.Sprintf("yt-dlp failed: %v — %s", cmdErr, string(output))
			job.CompletedAt = time.Now().Format(time.RFC3339)
			dbUpdateJob(job)
			log.Printf("[download] yt-dlp failed for %q: %v", job.SearchQuery, cmdErr)
			return
		}
	case <-time.After(downloadTimeout):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		job.Status = "failed"
		job.Error = "Download timed out after " + downloadTimeout.String()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		log.Printf("[download] Timed out after %v for %q", downloadTimeout, job.SearchQuery)
		return
	}

	audioFile := findDownloadedFile(destDir, safeTitle)
	if audioFile == "" {
		job.Status = "failed"
		job.Error = "Download completed but file not found"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		return
	}

	job.ProgressStage = "Validating audio"
	dbUpdateJob(job)

	if ok, reason := validateAudioIntegrity(audioFile); !ok {
		os.Remove(audioFile)
		job.Status = "failed"
		job.Error = fmt.Sprintf("Audio validation failed: %s", reason)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		dbUpdateJob(job)
		return
	}

	quality := probeAudioQuality(audioFile)
	if minBr > 0 && quality != "" {
		br := extractBitrateFromQuality(quality)
		if br > 0 && br < minBr {
			os.Remove(audioFile)
			job.Status = "failed"
			job.Error = fmt.Sprintf("Bitrate too low: %dkbps < %dkbps minimum", br, minBr)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			dbUpdateJob(job)
			log.Printf("[download] Rejected %q: bitrate %dkbps below minimum %dkbps", job.SearchQuery, br, minBr)
			return
		}
	}

	job.ProgressStage = "Tagging file"
	dbUpdateJob(job)

	if job.Pipeline == "v2" {
		job.ProgressStage = "Enriching metadata"
		dbUpdateJob(job)
		enrichWithPython(audioFile, job)
	} else {
		tagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
	}

	quality = probeAudioQuality(audioFile)

	job.Status = "completed"
	job.AudioQuality = quality
	job.FilePath = audioFile
	job.ProgressStage = "Done"
	job.CompletedAt = time.Now().Format(time.RFC3339)
	dbUpdateJob(job)

	log.Printf("[download] Completed: %s - %s -> %s (%s)", job.Artist, job.Title, audioFile, quality)

	go func() {
		time.Sleep(1 * time.Second)
		scanMusicDir(musicDir)

		if job.PlaylistID != "" && job.Artist != "" && job.Title != "" {
			mu.RLock()
			for _, tr := range tracks {
				if strings.EqualFold(tr.Artist, job.Artist) && strings.EqualFold(tr.Title, job.Title) {
					dbAddTrackToPlaylist(job.PlaylistID, tr.ID)
					log.Printf("[download] Added %s - %s to playlist %s", tr.Artist, tr.Title, job.PlaylistID)
					break
				}
			}
			mu.RUnlock()
		}
	}()
}

func searchYouTubeWithTimeout(query, expectedArtist, expectedTitle string, timeout time.Duration) ([]YTSearchCandidate, error) {
	type result struct {
		candidates []YTSearchCandidate
		err        error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := searchYouTubeScored(query, expectedArtist, expectedTitle)
		ch <- result{c, err}
	}()
	select {
	case r := <-ch:
		return r.candidates, r.err
	case <-time.After(timeout):
		return nil, fmt.Errorf("search timed out after %v", timeout)
	}
}

type YTSearchCandidate struct {
	VideoID  string `json:"videoId"`
	Title    string `json:"title"`
	Channel  string `json:"channel"`
	Duration int    `json:"duration"`
	Score    float64 `json:"score"`
}

func searchYouTubeScored(query, expectedArtist, expectedTitle string) ([]YTSearchCandidate, error) {
	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		return nil, fmt.Errorf("yt-dlp not found")
	}

	cmd := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytsearch10:%s", query),
	)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp search failed: %w", err)
	}

	type rawResult struct {
		ID        string  `json:"id"`
		Title     string  `json:"title"`
		Channel   string  `json:"channel"`
		Duration  float64 `json:"duration"`
		ViewCount int     `json:"view_count"`
	}

	var raw []rawResult
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var r rawResult
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			continue
		}
		if r.ID != "" && r.Duration > 15 {
			raw = append(raw, r)
		}
	}

	if len(raw) == 0 {
		return nil, fmt.Errorf("no results found on YouTube")
	}

	candidates := make([]YTSearchCandidate, len(raw))
	for i, r := range raw {
		s := scoreSearchResult(r.Title, r.Channel, expectedArtist, expectedTitle, r.Duration)
		candidates[i] = YTSearchCandidate{
			VideoID:  r.ID,
			Title:    r.Title,
			Channel:  r.Channel,
			Duration: int(r.Duration),
			Score:    s,
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	return candidates, nil
}

func searchYouTube(query, expectedArtist, expectedTitle string) (string, error) {
	candidates, err := searchYouTubeScored(query, expectedArtist, expectedTitle)
	if err != nil {
		return "", err
	}
	return candidates[0].VideoID, nil
}

func scoreSearchResult(title, channel, expectedArtist, expectedTitle string, duration float64) float64 {
	score := 0.0
	t := strings.ToLower(title)
	c := strings.ToLower(channel)
	a := strings.ToLower(expectedArtist)

	if a != "" && strings.Contains(c, a) {
		score += 60
	}
	if a != "" && levenshteinContains(t, a) {
		score += 40
	}

	if expectedTitle != "" {
		et := strings.ToLower(expectedTitle)
		if strings.Contains(t, et) {
			score += 50
		} else if levenshteinContains(t, et) {
			score += 30
		}
	}

	lowerWords := []string{
		"karaoke", "instrumental", "cover", "tutorial", "reaction",
		"review", "mashup", "parody", "backing track", "how to play",
		"top 10", "top 5", "compilation", "mix -", "dj mix",
		"8d audio", "bass boosted", "nightcore", "slowed",
	}
	for _, w := range lowerWords {
		if strings.Contains(t, w) {
			score -= 60
		}
	}

	if strings.Contains(t, "remix") && !strings.Contains(strings.ToLower(expectedTitle), "remix") {
		score -= 40
	}
	if strings.Contains(t, "live") && !strings.Contains(strings.ToLower(expectedTitle), "live") {
		score -= 30
	}
	if strings.Contains(t, "feat.") && !strings.Contains(strings.ToLower(expectedTitle), "feat") {
		score -= 10
	}

	upperWords := []string{"official", "audio", "lyric"}
	for _, w := range upperWords {
		if strings.Contains(t, w) {
			score += 10
		}
	}

	if duration > 60*60 {
		score -= 20
	}

	return score
}

func levenshteinContains(s, sub string) bool {
	if len(sub) == 0 {
		return false
	}
	subLower := strings.ToLower(sub)
	sLower := strings.ToLower(s)
	if strings.Contains(sLower, subLower) {
		return true
	}
	words := strings.Fields(subLower)
	matched := 0
	for _, w := range words {
		if len(w) > 2 && strings.Contains(sLower, w) {
			matched++
		}
	}
	return matched >= len(words)/2+1
}

func findDownloadedFile(dir, expectedTitle string) string {
	extensions := []string{".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	expectedLower := strings.ToLower(expectedTitle)

	var newestMatch string
	var newestTime time.Time

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

		if expectedLower != "" && strings.Contains(strings.ToLower(e.Name()), expectedLower) {
			return filepath.Join(dir, e.Name())
		}

		if info.ModTime().After(newestTime) {
			newestTime = info.ModTime()
			newestMatch = filepath.Join(dir, e.Name())
		}
	}

	return newestMatch
}

func validateAudioIntegrity(filePath string) (bool, string) {
	ffprobePath, _ := exec.LookPath("ffprobe")
	if ffprobePath == "" {
		return true, ""
	}

	cmd := exec.Command(ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration,size:stream=codec_type",
		"-of", "json",
		filePath,
	)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Sprintf("ffprobe failed: %v", err)
	}

	var info struct {
		Format struct {
			Duration string `json:"duration"`
			Size     string `json:"size"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &info); err != nil {
		return false, "invalid probe output"
	}

	hasAudio := false
	for _, s := range info.Streams {
		if s.CodecType == "audio" {
			hasAudio = true
		}
	}
	if !hasAudio {
		return false, "no audio stream found"
	}

	if info.Format.Duration == "" || info.Format.Duration == "N/A" {
		return false, "no duration"
	}
	dur, err := strconv.ParseFloat(info.Format.Duration, 64)
	if err != nil || dur <= 0 {
		return false, "invalid duration"
	}

	return true, ""
}

func tagAudioFile(filePath, artist, title, album string, trackNum, trackTotal int) {
	ffmpegPath, _ := exec.LookPath("ffmpeg")
	if ffmpegPath == "" {
		return
	}

	tmpFile := filePath + ".tagged" + filepath.Ext(filePath)

	args := []string{"-y", "-i", filePath}
	if artist != "" {
		args = append(args, "-metadata", fmt.Sprintf("artist=%s", artist))
	}
	if title != "" {
		args = append(args, "-metadata", fmt.Sprintf("title=%s", title))
	}
	if album != "" {
		args = append(args, "-metadata", fmt.Sprintf("album=%s", album))
	}
	if trackNum > 0 {
		trackVal := fmt.Sprintf("%d", trackNum)
		if trackTotal > 0 {
			trackVal = fmt.Sprintf("%d/%d", trackNum, trackTotal)
		}
		args = append(args, "-metadata", fmt.Sprintf("track=%s", trackVal))
	}
	args = append(args, "-c", "copy", tmpFile)

	cmd := exec.Command(ffmpegPath, args...)
	if err := cmd.Run(); err != nil {
		os.Remove(tmpFile)
		return
	}

	info, err := os.Stat(tmpFile)
	if err != nil || info.Size() == 0 {
		os.Remove(tmpFile)
		return
	}

	os.Rename(tmpFile, filePath)
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
		"-show_entries", "stream=codec_name,bit_rate,sample_rate,bits_per_raw_sample",
		"-of", "json",
		filePath,
	)
	output, err := cmd.Output()
	if err != nil {
		return ""
	}

	var info struct {
		Streams []struct {
			CodecName      string `json:"codec_name"`
			BitRate        string `json:"bit_rate"`
			SampleRate     string `json:"sample_rate"`
			BitsPerSample  string `json:"bits_per_raw_sample"`
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

func extractBitrateFromQuality(quality string) int {
	parts := strings.Fields(quality)
	for _, p := range parts {
		if strings.HasSuffix(p, "kbps") {
			n, err := strconv.Atoi(strings.TrimSuffix(p, "kbps"))
			if err == nil {
				return n
			}
		}
	}
	return 0
}

func recoverStalledDownloads() {
	stalled := []string{"searching", "downloading", "tagging"}
	for _, status := range stalled {
		result, _ := db.Exec("UPDATE download_jobs SET status = 'queued', progress_stage = '', error = '' WHERE status = ?", status)
		if affected, _ := result.RowsAffected(); affected > 0 {
			log.Printf("[download] Recovered %d stalled %s jobs back to queued", affected, status)
		}
	}
	go processDownloadQueue()
}

func downloadWatchdog() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		downloadMu.Lock()
		now := time.Now()
		for jobID, startTime := range activeJobTime {
			if now.Sub(startTime) > downloadTimeout+time.Minute {
				if cmd, ok := activeJobs[jobID]; ok && cmd.Process != nil {
					log.Printf("[download-watchdog] Killing stalled job %s (running %v)", jobID, now.Sub(startTime))
					cmd.Process.Kill()
				}
			}
		}
		downloadMu.Unlock()

		jobs, _ := dbGetQueuedJobs()
		if len(jobs) > 0 {
			downloadMu.Lock()
			active := downloadActive
			downloadMu.Unlock()
			if active < cap(downloadSem) {
				go processDownloadQueue()
			}
		}
	}
}
