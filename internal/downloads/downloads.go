package downloads

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
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
	DownloadMu     sync.Mutex
	DownloadActive int
	DownloadSem    = make(chan struct{}, 3)
	ActiveJobs     = make(map[string]*exec.Cmd)
	ActiveJobTime  = make(map[string]time.Time)
)

const DownloadTimeout = 10 * time.Minute
const SearchTimeout = 2 * time.Minute

// EnrichFunc is a callback set by main to break the circular dependency.
// When a v2 pipeline job completes, it calls EnrichFunc for metadata enrichment.
// If nil, TagAudioFile is used as fallback.
var EnrichFunc func(audioFile string, job *DownloadJob)

func FindYtDlp() string {
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

func FindFfmpeg() string {
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

func FindFfprobe() string {
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

func InitDownloadTables() {
	store.DB.Exec(`CREATE TABLE IF NOT EXISTS download_jobs (
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
		store.DB.Exec(m)
	}
}

func DbCreateJob(job *DownloadJob) error {
	_, err := store.DB.Exec(`INSERT INTO download_jobs
		(id, query, artist, title, album, album_mbid, track_number, track_total,
		 status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		 override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Query, job.Artist, job.Title, job.Album, job.AlbumMBID,
		job.TrackNumber, job.TrackTotal, job.Status, job.Error, job.Source,
		job.AudioQuality, job.FilePath, store.BoolToInt(job.FileDeleted), job.ProgressStage,
		job.OverrideDir, job.SearchQuery, store.BoolToInt(job.ConvertToFlac), job.PlaylistID, job.VideoID, job.CreatedAt, job.CompletedAt)
	return err
}

func DbUpdateJob(job *DownloadJob) error {
	_, err := store.DB.Exec(`UPDATE download_jobs SET
		status = ?, error = ?, source = ?, audio_quality = ?,
		file_path = ?, file_deleted = ?, progress_stage = ?, completed_at = ?,
		pipeline = ?, recording_id = ?, release_id = ?, artist_id = ?, genre = ?, year = ?,
		candidates = ?, video_id = ?
		WHERE id = ?`,
		job.Status, job.Error, job.Source, job.AudioQuality,
		job.FilePath, store.BoolToInt(job.FileDeleted), job.ProgressStage, job.CompletedAt,
		job.Pipeline, job.RecordingID, job.ReleaseID, job.ArtistID, job.Genre, job.Year,
		job.CandidatesJSON, job.VideoID,
		job.ID)
	return err
}

func DbGetJob(id string) (*DownloadJob, error) {
	row := store.DB.QueryRow(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs WHERE id = ?`, id)
	return ScanJob(row)
}

func DbGetJobs(limit int) ([]DownloadJob, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := store.DB.Query(`SELECT
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
	return ScanJobs(rows)
}

func DbGetQueuedJobs() ([]DownloadJob, error) {
	rows, err := store.DB.Query(`SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs WHERE status = 'queued' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return ScanJobs(rows)
}

func DbGetJobCounts() map[string]int {
	counts := map[string]int{"queued": 0, "searching": 0, "downloading": 0, "tagging": 0, "completed": 0, "failed": 0, "needs_selection": 0}
	rows, err := store.DB.Query("SELECT status, COUNT(*) FROM download_jobs GROUP BY status")
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

func ScanJob(row *sql.Row) (*DownloadJob, error) {
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

func ScanJobs(rows *sql.Rows) ([]DownloadJob, error) {
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

func CreateDownloadJob(query, artist, title, album, albumMBID string, trackNum, trackTotal int, overrideDir, videoID string) (*DownloadJob, error) {
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

	store.Mu.RLock()
	existing := store.Tracks
	store.Mu.RUnlock()
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

	if err := DbCreateJob(job); err != nil {
		return nil, err
	}

	go ProcessDownloadQueue()
	return job, nil
}

func ProcessDownloadQueue() {
	DownloadMu.Lock()
	if DownloadActive >= cap(DownloadSem) {
		DownloadMu.Unlock()
		return
	}
	DownloadActive++
	DownloadMu.Unlock()

	defer func() {
		DownloadMu.Lock()
		DownloadActive--
		DownloadMu.Unlock()
	}()

	for {
		jobs, err := DbGetQueuedJobs()
		if err != nil || len(jobs) == 0 {
			return
		}

		DownloadMu.Lock()
		if DownloadActive > cap(DownloadSem) {
			DownloadMu.Unlock()
			return
		}
		DownloadMu.Unlock()

		job := &jobs[0]
		DownloadSem <- struct{}{}
		ProcessSingleDownload(job)
		<-DownloadSem

		time.Sleep(500 * time.Millisecond)
	}
}

func ProcessSingleDownload(job *DownloadJob) {
	ytdlpPath := FindYtDlp()
	if ytdlpPath == "" {
		job.Status = "failed"
		job.Error = "yt-dlp not found. Install with: pip install yt-dlp  OR  apt install yt-dlp  OR  apk add yt-dlp"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] yt-dlp not found on PATH or known locations")
		return
	}
	log.Printf("[download] using yt-dlp at %s", ytdlpPath)

	job.Status = "searching"
	job.ProgressStage = "Searching YouTube"
	DbUpdateJob(job)

	var videoID string
	if job.VideoID != "" {
		videoID = job.VideoID
		log.Printf("[download] Using direct video ID %s for %q", videoID, job.SearchQuery)
	} else {
		candidates, serr := SearchYouTubeWithTimeout(job.SearchQuery, job.Artist, job.Title, SearchTimeout)
		if serr != nil {
			job.Status = "failed"
			job.Error = fmt.Sprintf("Search failed: %v", serr)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			log.Printf("[download] Search failed for %q: %v", job.SearchQuery, serr)
			return
		}
		if len(candidates) == 0 {
			job.Status = "failed"
			job.Error = "No results found on YouTube"
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
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
			DbUpdateJob(job)
			log.Printf("[download] Low confidence (%.1f) for %q, waiting for user selection", candidates[0].Score, job.SearchQuery)
			return
		}

		videoID = candidates[0].VideoID
		log.Printf("[download] Auto-selected %s (score %.1f) for %q", videoID, candidates[0].Score, job.SearchQuery)
	}

	destDir := store.MusicDir
	organise := store.GetSettingBool("download_organise_by_artist", true)
	albumSubdir := store.GetSetting("download_album_subdir", "Albums")
	if albumSubdir == "" {
		albumSubdir = "Albums"
	}

	if job.OverrideDir != "" {
		destDir = job.OverrideDir
	} else if job.Album != "" && job.Artist != "" {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist), SanitizeFilename(job.Album))
	} else if job.Artist != "" && organise {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist))
	} else {
		destDir = store.MusicDir
	}
	os.MkdirAll(destDir, 0755)

	job.Status = "downloading"
	job.Source = "youtube"
	job.ProgressStage = "Downloading audio"
	DbUpdateJob(job)

	safeTitle := SanitizeFilename(job.Title)
	if safeTitle == "" {
		safeTitle = SanitizeFilename(job.SearchQuery)
	}
	if safeTitle == "" {
		safeTitle = "track"
	}
	outputTemplate := filepath.Join(destDir, safeTitle+".%(ext)s")

	url := fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID)

	audioFormat := store.GetSetting("download_format", "flac")
	audioQuality := "0"
	switch audioFormat {
	case "mp3":
		audioQuality = store.GetSetting("mp3_bitrate", "v2")
	case "opus":
		audioQuality = store.GetSetting("opus_bitrate", "320k")
	case "best", "m4a":
		audioFormat = "best"
		audioQuality = "0"
	default:
		audioFormat = "flac"
	}

	if !store.GetSettingBool("download_convert_to_flac", true) {
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

	minBr := store.GetSettingInt("download_min_bitrate", 0)

	cmd := exec.Command(ytdlpPath, ytArgs...)

	DownloadMu.Lock()
	ActiveJobs[job.ID] = cmd
	ActiveJobTime[job.ID] = time.Now()
	DownloadMu.Unlock()

	defer func() {
		DownloadMu.Lock()
		delete(ActiveJobs, job.ID)
		delete(ActiveJobTime, job.ID)
		DownloadMu.Unlock()
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
			DbUpdateJob(job)
			log.Printf("[download] yt-dlp failed for %q: %v", job.SearchQuery, cmdErr)
			return
		}
	case <-time.After(DownloadTimeout):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		job.Status = "failed"
		job.Error = "Download timed out after " + DownloadTimeout.String()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] Timed out after %v for %q", DownloadTimeout, job.SearchQuery)
		return
	}

	audioFile := FindDownloadedFile(destDir, safeTitle)
	if audioFile == "" {
		job.Status = "failed"
		job.Error = "Download completed but file not found"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	job.ProgressStage = "Validating audio"
	DbUpdateJob(job)

	if ok, reason := ValidateAudioIntegrity(audioFile); !ok {
		os.Remove(audioFile)
		job.Status = "failed"
		job.Error = fmt.Sprintf("Audio validation failed: %s", reason)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	quality := ProbeAudioQuality(audioFile)
	if minBr > 0 && quality != "" {
		br := ExtractBitrateFromQuality(quality)
		if br > 0 && br < minBr {
			os.Remove(audioFile)
			job.Status = "failed"
			job.Error = fmt.Sprintf("Bitrate too low: %dkbps < %dkbps minimum", br, minBr)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			log.Printf("[download] Rejected %q: bitrate %dkbps below minimum %dkbps", job.SearchQuery, br, minBr)
			return
		}
	}

	job.ProgressStage = "Tagging file"
	DbUpdateJob(job)

	if job.Pipeline == "v2" && EnrichFunc != nil {
		job.ProgressStage = "Enriching metadata"
		DbUpdateJob(job)
		EnrichFunc(audioFile, job)
	} else {
		TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
	}

	quality = ProbeAudioQuality(audioFile)

	job.Status = "completed"
	job.AudioQuality = quality
	job.FilePath = audioFile
	job.ProgressStage = "Done"
	job.CompletedAt = time.Now().Format(time.RFC3339)
	DbUpdateJob(job)

	log.Printf("[download] Completed: %s - %s -> %s (%s)", job.Artist, job.Title, audioFile, quality)

	go func() {
		time.Sleep(1 * time.Second)
		scanner.ScanSingleFile(audioFile)

		if job.PlaylistID != "" && job.Artist != "" && job.Title != "" {
			store.Mu.RLock()
			for _, tr := range store.Tracks {
				if strings.EqualFold(tr.Artist, job.Artist) && strings.EqualFold(tr.Title, job.Title) {
					store.DbAddTrackToPlaylist(job.PlaylistID, tr.ID)
					log.Printf("[download] Added %s - %s to playlist %s", tr.Artist, tr.Title, job.PlaylistID)
					break
				}
			}
			store.Mu.RUnlock()
		}
	}()
}

func SearchYouTubeWithTimeout(query, expectedArtist, expectedTitle string, timeout time.Duration) ([]YTSearchCandidate, error) {
	type result struct {
		candidates []YTSearchCandidate
		err        error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := SearchYouTubeScored(query, expectedArtist, expectedTitle)
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
	VideoID  string  `json:"videoId"`
	Title    string  `json:"title"`
	Channel  string  `json:"channel"`
	Duration int     `json:"duration"`
	Score    float64 `json:"score"`
}

func SearchYouTubeScored(query, expectedArtist, expectedTitle string) ([]YTSearchCandidate, error) {
	ytdlpPath := FindYtDlp()
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

	musicOutput, musicErr := exec.Command(ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytmsearch5:%s", query),
	).Output()

	type rawResult struct {
		ID          string  `json:"id"`
		Title       string  `json:"title"`
		Channel     string  `json:"channel"`
		Uploader    string  `json:"uploader"`
		Duration    float64 `json:"duration"`
		ViewCount   int     `json:"view_count"`
		Extractor   string  `json:"extractor"`
		WebpageURL  string  `json:"webpage_url"`
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

	if len(raw) == 0 && musicErr != nil {
		return nil, fmt.Errorf("no results found on YouTube")
	}

	if musicErr == nil {
		for _, line := range strings.Split(string(musicOutput), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var r rawResult
			if err := json.Unmarshal([]byte(line), &r); err != nil {
				continue
			}
			if r.ID != "" && r.Duration > 15 {
				r.Extractor = "youtube:music"
				raw = append(raw, r)
			}
		}
	}

	seen := make(map[string]bool)
	deduped := raw[:0]
	for _, r := range raw {
		if !seen[r.ID] {
			seen[r.ID] = true
			deduped = append(deduped, r)
		}
	}
	raw = deduped

	if len(raw) == 0 {
		return nil, fmt.Errorf("no results found on YouTube")
	}

	candidates := make([]YTSearchCandidate, 0, len(raw))
	for _, r := range raw {
		s := ScoreSearchResult(r.Title, r.Channel, expectedArtist, expectedTitle, r.Duration)
		if r.Extractor == "youtube:music" {
			s += 25
		}
		candidates = append(candidates, YTSearchCandidate{
			VideoID:  r.ID,
			Title:    r.Title,
			Channel:  r.Channel,
			Duration: int(r.Duration),
			Score:    s,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	return candidates, nil
}

func SearchYouTube(query, expectedArtist, expectedTitle string) (string, error) {
	candidates, err := SearchYouTubeScored(query, expectedArtist, expectedTitle)
	if err != nil {
		return "", err
	}
	return candidates[0].VideoID, nil
}

func ScoreSearchResult(title, channel, expectedArtist, expectedTitle string, duration float64) float64 {
	score := 0.0
	t := strings.ToLower(title)
	c := strings.ToLower(channel)
	a := strings.ToLower(expectedArtist)

	if a != "" && strings.Contains(c, a) {
		score += 60
	}
	if a != "" && LevenshteinContains(t, a) {
		score += 40
	}

	if expectedTitle != "" {
		et := strings.ToLower(expectedTitle)
		if strings.Contains(t, et) {
			score += 50
		} else if LevenshteinContains(t, et) {
			score += 30
		}
	}

	lowerWords := []string{
		"karaoke", "instrumental", "cover", "tutorial", "reaction",
		"review", "mashup", "parody", "backing track", "how to play",
		"top 10", "top 5", "compilation", "mix -", "dj mix",
		"8d audio", "bass boosted", "nightcore", "slowed",
		"podcast", "episode", "interview", "vlog", "unboxing",
		"trailer", "teaser", "behind the scenes", "making of",
		"full album stream",
	}
	for _, w := range lowerWords {
		if strings.Contains(t, w) {
			score -= 60
		}
	}

	videoContentWords := []string{
		"gameplay", "walkthrough", "let's play", "stream highlight",
		"funny moments", "fails", "prank", "challenge",
	}
	for _, w := range videoContentWords {
		if strings.Contains(t, w) {
			score -= 80
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

	musicSignals := []string{
		"provided to youtube", "auto-generated by youtube",
	}
	lowerFull := strings.ToLower(title + " " + channel)
	for _, sig := range musicSignals {
		if strings.Contains(lowerFull, sig) {
			score += 15
		}
	}

	if strings.HasSuffix(c, " - topic") || strings.HasSuffix(c, " topic") {
		score += 20
	}

	if strings.HasSuffix(c, "vevo") {
		score += 10
	}

	nonMusicChannels := []string{
		"games", "gaming", "funny", "fails", "clips",
	}
	channelWords := strings.Fields(c)
	for _, cw := range channelWords {
		for _, nm := range nonMusicChannels {
			if cw == nm {
				score -= 30
			}
		}
	}

	if duration > 60*60 {
		score -= 20
	}
	if duration > 0 && duration < 30 {
		score -= 40
	}

	return score
}

func LevenshteinContains(s, sub string) bool {
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

func FindDownloadedFile(dir, expectedTitle string) string {
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

func ValidateAudioIntegrity(filePath string) (bool, string) {
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

func TagAudioFile(filePath, artist, title, album string, trackNum, trackTotal int) {
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

func SanitizeFilename(name string) string {
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

func ProbeAudioQuality(filePath string) string {
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
			CodecName     string `json:"codec_name"`
			BitRate       string `json:"bit_rate"`
			SampleRate    string `json:"sample_rate"`
			BitsPerSample string `json:"bits_per_raw_sample"`
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

func ExtractBitrateFromQuality(quality string) int {
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

func RecoverStalledDownloads() {
	stalled := []string{"searching", "downloading", "tagging"}
	for _, status := range stalled {
		result, _ := store.DB.Exec("UPDATE download_jobs SET status = 'queued', progress_stage = '', error = '' WHERE status = ?", status)
		if affected, _ := result.RowsAffected(); affected > 0 {
			log.Printf("[download] Recovered %d stalled %s jobs back to queued", affected, status)
		}
	}
	go ProcessDownloadQueue()
}

func DownloadWatchdog() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		DownloadMu.Lock()
		now := time.Now()
		for jobID, startTime := range ActiveJobTime {
			if now.Sub(startTime) > DownloadTimeout+time.Minute {
				if cmd, ok := ActiveJobs[jobID]; ok && cmd.Process != nil {
					log.Printf("[download-watchdog] Killing stalled job %s (running %v)", jobID, now.Sub(startTime))
					cmd.Process.Kill()
				}
			}
		}
		DownloadMu.Unlock()

		jobs, _ := DbGetQueuedJobs()
		if len(jobs) > 0 {
			DownloadMu.Lock()
			active := DownloadActive
			DownloadMu.Unlock()
			if active < cap(DownloadSem) {
				go ProcessDownloadQueue()
			}
		}
	}
}
