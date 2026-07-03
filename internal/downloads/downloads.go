package downloads

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
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
	ActiveJobs     = make(map[string]*exec.Cmd)
	ActiveJobTime  = make(map[string]time.Time)
)

// MaxConcurrentDownloads returns the configured concurrency limit (default 3).
func MaxConcurrentDownloads() int {
	n := store.GetSettingInt("download_concurrency", 3)
	if n < 1 {
		n = 1
	}
	if n > 10 {
		n = 10
	}
	return n
}

// tryAcquireSlot returns true if a download slot was acquired.
// Uses a counting approach instead of a fixed channel so the limit is
// configurable at runtime.
func tryAcquireSlot() bool {
	DownloadMu.Lock()
	defer DownloadMu.Unlock()
	if DownloadActive >= MaxConcurrentDownloads() {
		return false
	}
	DownloadActive++
	return true
}

func releaseSlot() {
	DownloadMu.Lock()
	DownloadActive--
	if DownloadActive < 0 {
		DownloadActive = 0
	}
	DownloadMu.Unlock()
}

const DownloadTimeout = 10 * time.Minute
const SearchTimeout = 2 * time.Minute

// Bot-backoff and stale-cookie cooldown, adapted from patterns used by other
// yt-dlp frontends (e.g. musicgrabber). These keep us from hammering YouTube
// right after a block and from letting one set of stale cookies poison every
// subsequent download.
var (
	ytMu                 sync.Mutex
	botBackoffUntil      time.Time
	cookiesDisabledUntil time.Time
)

const (
	botBackoffMin      = 5 * time.Second
	botBackoffMax      = 20 * time.Second
	cookieFailCooldown = 2 * time.Hour
)

func noteBotBlock() {
	sleep := botBackoffMin + time.Duration(rand.Int63n(int64(botBackoffMax-botBackoffMin)+1))
	ytMu.Lock()
	botBackoffUntil = time.Now().Add(sleep)
	ytMu.Unlock()
}

func sleepIfBotted() {
	ytMu.Lock()
	wait := botBackoffUntil.Sub(time.Now())
	ytMu.Unlock()
	if wait > 0 {
		log.Printf("[download] bot-backoff: sleeping %v before next yt-dlp call", wait)
		time.Sleep(wait)
	}
}

func cookiesAllowed() bool {
	ytMu.Lock()
	defer ytMu.Unlock()
	return time.Now().After(cookiesDisabledUntil)
}

func noteCookieFailure() {
	ytMu.Lock()
	cookiesDisabledUntil = time.Now().Add(cookieFailCooldown)
	ytMu.Unlock()
}

func isYtdlp403(output string) bool {
	l := strings.ToLower(output)
	return strings.Contains(l, "403") || strings.Contains(l, "forbidden") || strings.Contains(l, "sign in to confirm")
}

func shouldRetryWithoutCookies(output string) bool {
	l := strings.ToLower(output)
	return isYtdlp403(output) ||
		strings.Contains(l, "downloaded file is empty") ||
		strings.Contains(l, "requested format is not available")
}

func argsHaveCookies(args []string) bool {
	for _, a := range args {
		if a == "--cookies" || a == "--cookies-from-browser" {
			return true
		}
	}
	return false
}

func stripCookiesArgs(args []string) []string {
	var out []string
	skip := false
	for _, a := range args {
		if skip {
			skip = false
			continue
		}
		if a == "--cookies" || a == "--cookies-from-browser" {
			skip = true
			continue
		}
		out = append(out, a)
	}
	return out
}

// EnrichFunc is a callback set by main to break the circular dependency.
// When a v2 pipeline job completes, it calls EnrichFunc for metadata enrichment.
// If nil, TagAudioFile is used as fallback.
var EnrichFunc func(audioFile string, job *DownloadJob)

// FindBinary locates an executable by name on PATH, falling back to a list of
// well-known absolute paths (checked via os.Stat). Returns "" if not found.
func FindBinary(name string, fallbackPaths ...string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, p := range fallbackPaths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func FindYtDlp() string {
	return FindBinary("yt-dlp",
		"/opt/homebrew/bin/yt-dlp",
		"/usr/local/bin/yt-dlp",
		"/usr/bin/yt-dlp",
	)
}

func FindFfmpeg() string {
	return FindBinary("ffmpeg",
		"/opt/homebrew/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/usr/bin/ffmpeg",
	)
}

// YtCommonArgs returns yt-dlp flags shared by every stream-resolving command:
// an optional player client override, plus cookies (file or browser).
//
// By default ("default" sentinel or empty) NO player_client override is passed,
// letting yt-dlp use its built-in client cascade — yt-dlp's maintainers
// recommend this, since the cascade picks clients that don't currently require
// a PO Token. Forcing a single client (e.g. "web") disables that cascade and
// "web" in particular is one of the most aggressively throttled clients.
//
// YouTube increasingly bot-blocks requests ("Sign in to confirm you're not a
// bot"); passing cookies (a Netscape cookies.txt exported from a logged-in
// YouTube session) is the standard workaround. See:
// https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies
func YtCommonArgs() []string {
	var args []string
	if client := store.GetSetting("yt_player_client", "default"); client != "" && client != "default" {
		args = append(args, "--extractor-args", "youtube:player_client="+client)
	}
	if cookiesAllowed() {
		if cookiesFile := store.GetSetting("yt_cookies_file", ""); cookiesFile != "" {
			args = append([]string{"--cookies", cookiesFile}, args...)
		} else if cookiesFrom := store.GetSetting("yt_cookies_from_browser", ""); cookiesFrom != "" {
			args = append([]string{"--cookies-from-browser", cookiesFrom}, args...)
		}
	}
	return args
}

// runDownloadCmd executes a yt-dlp download command with active-job tracking
// and the standard download timeout. Returns combined output, error, and
// whether it timed out (and was killed).
func runDownloadCmd(jobID, ytdlpPath string, args []string) (output string, err error, timedOut bool) {
	cmd := exec.Command(ytdlpPath, args...)
	// Put yt-dlp in its own process group so we can kill the whole tree
	// (ffmpeg/aria2c children). Without this, killing yt-dlp orphans its
	// children which hold the stdout pipe open and block CombinedOutput forever.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	DownloadMu.Lock()
	ActiveJobs[jobID] = cmd
	ActiveJobTime[jobID] = time.Now()
	DownloadMu.Unlock()
	defer func() {
		DownloadMu.Lock()
		delete(ActiveJobs, jobID)
		delete(ActiveJobTime, jobID)
		DownloadMu.Unlock()
	}()

	done := make(chan struct{})
	var out []byte
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[download-cmd] panic recovered: %v\n%s", r, debug.Stack())
			}
			close(done)
		}()
		out, err = cmd.CombinedOutput()
	}()
	select {
	case <-done:
		return string(out), err, false
	case <-time.After(DownloadTimeout):
		if cmd.Process != nil {
			// Kill the entire process group (negative pid) so yt-dlp's
			// children (ffmpeg/aria2c) die with it instead of orphaning.
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		<-done
		return string(out), err, true
	}
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

// DbGetJobs returns download jobs. status filters: "" = all (ordered
// actionable-first), "active" = searching/downloading/tagging, otherwise a
// literal status value. Per-status filtering avoids the 1000-row cap hiding
// completed/failed items behind a large queued backlog.
func DbGetJobs(limit int, status string) ([]DownloadJob, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT
		id, query, artist, title, album, album_mbid, track_number, track_total,
		status, error, source, audio_quality, file_path, file_deleted, progress_stage,
		override_dir, search_query, convert_to_flac, playlist_id, video_id, created_at, completed_at,
		pipeline, recording_id, release_id, artist_id, genre, year, candidates
		FROM download_jobs `
	var args []interface{}
	switch status {
	case "", "all":
		// no filter
	case "active":
		query += ` WHERE status IN ('searching','downloading','tagging') `
	default:
		query += ` WHERE status = ? `
		args = append(args, status)
	}
	query += ` ORDER BY
			CASE status
				WHEN 'searching' THEN 0
				WHEN 'downloading' THEN 1
				WHEN 'tagging' THEN 2
				WHEN 'needs_selection' THEN 3
				WHEN 'queued' THEN 4
				WHEN 'failed' THEN 5
				WHEN 'completed' THEN 6
				ELSE 7
			END,
			completed_at DESC,
			created_at DESC
		LIMIT ?`
	args = append(args, limit)
	rows, err := store.DB.Query(query, args...)
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
		searchQuery = strings.Join(parts, " - ")
	}

	if artist != "" && title != "" {
		store.Mu.RLock()
		for _, t := range store.Tracks {
			if strings.EqualFold(t.Artist, artist) && strings.EqualFold(t.Title, title) {
				store.Mu.RUnlock()
				return nil, fmt.Errorf("already in library")
			}
		}
		store.Mu.RUnlock()
	}

	// Dedup: reject if there's already a non-failed job for the same track.
	if artist != "" && title != "" {
		key := strings.ToLower(artist + "|" + title)
		var count int
		store.DB.QueryRow(`SELECT COUNT(*) FROM download_jobs WHERE LOWER(artist)||'|'||LOWER(title) = ? AND status != 'failed'`, key).Scan(&count)
		if count > 0 {
			return nil, fmt.Errorf("already in download queue")
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

	store.SafeGo("process-queue", func() { ProcessDownloadQueue() })
	return job, nil
}

func ProcessDownloadQueue() {
	if store.GetSettingBool("download_paused", false) {
		return
	}

	for {
		if store.GetSettingBool("download_paused", false) {
			return
		}

		// Try to acquire a concurrency slot. Non-blocking: if all slots are
		// busy, return and let the watchdog re-trigger when a slot frees.
		if !tryAcquireSlot() {
			return
		}

		// Find a queued job and atomically claim it.
		jobs, err := DbGetQueuedJobs()
		if err != nil || len(jobs) == 0 {
			// No jobs — release the slot and exit.
			releaseSlot()
			return
		}

		job := &jobs[0]
		res, _ := store.DB.Exec(`UPDATE download_jobs SET status='searching' WHERE id=? AND status='queued'`, job.ID)
		if n, _ := res.RowsAffected(); n == 0 {
			// Someone else claimed it — release slot and loop to try next.
			releaseSlot()
			continue
		}

		// Process this job in a goroutine. The slot is released when
		// the job finishes (success, failure, or panic).
		go func(j *DownloadJob) {
			defer releaseSlot()
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[download] PANIC in ProcessSingleDownload for %s: %v", j.ID, r)
					j.Status = "failed"
					j.Error = fmt.Sprintf("Internal error: %v", r)
					j.CompletedAt = time.Now().Format(time.RFC3339)
					DbUpdateJob(j)
				}
			}()
			ProcessSingleDownload(j)

			// Job finished — kick the queue in case there are more waiting.
			store.SafeGo("process-queue", func() { ProcessDownloadQueue() })
		}(job)

		time.Sleep(100 * time.Millisecond)
	}
}

// getDownloadSource returns the configured global source mode: "youtube",
// "soulseek", or "auto" (YouTube with Soulseek fallback on failure).
func getDownloadSource() string {
	switch s := store.GetSetting("download_source", "auto"); s {
	case "youtube", "soulseek", "auto":
		return s
	default:
		return "auto"
	}
}

// computeDest returns the destination directory + safe filename for a job,
// shared by the YouTube and Soulseek paths (extracted verbatim from the former
// ProcessSingleDownload body so both sources land files in the same layout).
func computeDest(job *DownloadJob) (destDir, safeTitle string) {
	destDir = store.MusicDir
	organise := store.GetSettingBool("download_organise_by_artist", true)
	// download_album_subdir is read for parity with the original block; it is
	// not currently used to alter the path but is preserved to avoid changing
	// observable behaviour (the value was always fetched).
	_ = store.GetSetting("download_album_subdir", "Albums")

	if job.OverrideDir != "" {
		destDir = job.OverrideDir
	} else if job.Album != "" && job.Artist != "" {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist), SanitizeFilename(job.Album))
	} else if job.Artist != "" && organise {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist))
	} else {
		destDir = store.MusicDir
	}

	safeTitle = SanitizeFilename(job.Title)
	if safeTitle == "" {
		safeTitle = SanitizeFilename(job.SearchQuery)
	}
	if safeTitle == "" {
		safeTitle = "track"
	}
	return destDir, safeTitle
}

// finalizeDownload owns locate → validate → bitrate gate → tag → complete →
// scan/playlist. Shared by the YouTube and Soulseek download paths (DRY).
//
// downloadedPath is the resolved audio file: for YouTube it is the result of
// FindDownloadedFile(destDir, safeTitle); for Soulseek it is the absolute path
// reported by the python script. An empty path means the download produced no
// findable file and is treated as a failure.
// finalizeDownload validates, tags, and scans a downloaded file. Returns true
// only on full success (file validated + accepted). expectedDuration is the
// authoritative song length in seconds from the source (Soulseek candidate's
// self-reported duration; 0 when unknown). When known, a downloaded file whose
// real duration is < 80% of expected is rejected as truncated and deleted —
// the strongest signal against short-but-decodable partials.
func finalizeDownload(job *DownloadJob, downloadedPath string, expectedDuration int) bool {
	audioFile := downloadedPath
	if audioFile == "" {
		job.Status = "failed"
		job.Error = "Download completed but file not found"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return false
	}

	job.ProgressStage = "Validating audio"
	DbUpdateJob(job)

	ok, reason, probedDur := ValidateAudioIntegrity(audioFile)
	if !ok {
		os.Remove(audioFile)
		job.Status = "failed"
		job.Error = fmt.Sprintf("Audio validation failed: %s", reason)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return false
	}

	// Truncation check: the server's only reliable "is this the whole song?"
	// signal. ffprobe gives the real length; expectedDuration comes from the
	// source's own metadata (Soulseek candidate Duration). A clean-disconnect
	// partial reads as COMPLETE to Soulseek but decodes short — this catches it.
	// ponytail: 0.8 floor matches the python size check; tighten if false-negs.
	if expectedDuration > 0 && probedDur > 0 {
		if probedDur < float64(expectedDuration)*0.8 {
			os.Remove(audioFile)
			job.Status = "failed"
			job.Error = fmt.Sprintf("Truncated: %.0fs vs %ds expected (%.0f%%)", probedDur, expectedDuration, probedDur/float64(expectedDuration)*100)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			log.Printf("[download] Rejected truncated %q: %.0fs < 0.8×%ds", job.SearchQuery, probedDur, expectedDuration)
			return false
		}
	}

	minBr := store.GetSettingInt("download_min_bitrate", 0)
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
			return false
		}
	}

	job.ProgressStage = "Tagging file"
	DbUpdateJob(job)
	log.Printf("[download] Tagging %s - %s (album=%q)", job.Artist, job.Title, job.Album)

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

	// Scan synchronously — we hold a download slot and this eliminates the
	// race where AutoSort moves the file between the sleep and ScanSingleFile.
	scanner.ScanSingleFile(audioFile)

	// Persist the ffprobe-probed duration immediately. The scanner inserts
	// duration=0 (the tag library doesn't compute it) and duration is otherwise
	// only filled when a track is *played* in the browser. Recording it here
	// means unplayed downloads get a real duration, which arms the review
	// worker's short-duration check and the UI's seek bar.
	if probedDur > 0 {
		durSec := int(probedDur)
		store.Mu.Lock()
		for _, tr := range store.Tracks {
			if scanner.ResolveFilePath(tr.FilePath) == audioFile {
				if tr.Duration == 0 {
					tr.Duration = durSec
					store.DB.Exec("UPDATE tracks SET duration = ? WHERE id = ?", durSec, tr.ID)
				}
				break
			}
		}
		store.Mu.Unlock()
	}

	if job.AlbumMBID != "" {
		store.Mu.RLock()
		var albumID string
		for _, tr := range store.Tracks {
			if scanner.ResolveFilePath(tr.FilePath) == audioFile {
				albumID = tr.AlbumID
				break
			}
		}
		store.Mu.RUnlock()
		if albumID != "" {
			musicbrainz.FetchAndCacheCoverByMBID(albumID, job.AlbumMBID)
		}
	}

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
	return true
}

// ProcessSingleDownload routes a job to the configured source and handles
// auto-fallback from YouTube to Soulseek on failure. It is the dispatcher;
// per-source work lives in downloadFromYouTube / downloadFromSoulseek.
func ProcessSingleDownload(job *DownloadJob) {
	source := getDownloadSource()

	// A job already marked Soulseek (e.g. resumed after selection) stays on
	// the Soulseek path regardless of the global mode.
	if job.Source == "soulseek" {
		downloadFromSoulseek(job)
		return
	}
	if source == "soulseek" {
		downloadFromSoulseek(job)
		return
	}

	// "youtube" or "auto".
	ytOK := downloadFromYouTube(job)
	if ytOK || source == "youtube" {
		return
	}
	// auto-mode fallback: YouTube failed; try Soulseek on the same job.
	if !store.GetSettingBool("slsk_enabled", false) || findSlsk() == "" {
		return
	}
	log.Printf("[download] YouTube failed for %q, falling back to Soulseek", job.SearchQuery)
	// Clean up any partial/failed YouTube output before Soulseek writes to the
	// same destDir — otherwise both files survive and the scanner imports duplicates.
	destDir, safeTitle := computeDest(job)
	cleanupFailedDownload(destDir, safeTitle)
	// NOTE: do NOT set job.Source = "soulseek" here. Persisting it would pin the
	// job to Soulseek, so a retry (after this fallback also fails) would skip
	// YouTube entirely. Leaving Source unset lets ProcessSingleDownload
	// re-evaluate getDownloadSource() on each attempt.
	job.Error = ""
	job.ProgressStage = ""
	job.CompletedAt = ""
	downloadFromSoulseek(job)
}

// downloadFromYouTube runs the existing YouTube flow. It returns true when the
// job reached a terminal non-failed state (completed or needs_selection); on
// any failed exit it leaves job.Status="failed" set and returns false so the
// dispatcher can attempt Soulseek fallback.
func downloadFromYouTube(job *DownloadJob) bool {
	ytdlpPath := FindYtDlp()
	if ytdlpPath == "" {
		job.Status = "failed"
		job.Error = "yt-dlp not found. Install with: pip install yt-dlp  OR  apt install yt-dlp  OR  apk add yt-dlp"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] yt-dlp not found on PATH or known locations")
		return false
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
			return false
		}
		if len(candidates) == 0 {
			job.Status = "failed"
			job.Error = "No results found on YouTube"
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			return false
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
			return true
		}

		videoID = candidates[0].VideoID
		log.Printf("[download] Auto-selected %s (score %.1f) for %q", videoID, candidates[0].Score, job.SearchQuery)
	}

	job.ProgressStage = "Found match, preparing download"
	DbUpdateJob(job)

	destDir, safeTitle := computeDest(job)
	os.MkdirAll(destDir, 0755)

	job.Status = "downloading"
	job.Source = "youtube"
	job.ProgressStage = "Downloading audio"
	DbUpdateJob(job)

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

	ytArgs := append(YtCommonArgs(),
		"-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
		"-x",
		"--audio-format", audioFormat,
		"--audio-quality", audioQuality,
		"--embed-thumbnail",
		"--convert-thumbnails", "jpg",
		"--no-warnings",
		"-o", outputTemplate,
		url,
	)

	sleepIfBotted()

	out, cmdErr, timedOut := runDownloadCmd(job.ID, ytdlpPath, ytArgs)
	if timedOut {
		job.Status = "failed"
		job.Error = "Download timed out after " + DownloadTimeout.String()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] Timed out after %v for %q", DownloadTimeout, job.SearchQuery)
		return false
	}
	if cmdErr != nil {
		if isYtdlp403(out) {
			noteBotBlock()
		}
		// If cookies are present and the failure looks cookie-caused, retry
		// once without them. A cookieless success means the cookies were
		// actively harmful (stale/premium session) — disable them for a while.
		if argsHaveCookies(ytArgs) && shouldRetryWithoutCookies(out) {
			log.Printf("[download] cookie-related failure for %q, retrying without cookies", job.SearchQuery)
			out2, cmdErr2, timedOut2 := runDownloadCmd(job.ID, ytdlpPath, stripCookiesArgs(ytArgs))
			if timedOut2 {
				job.Status = "failed"
				job.Error = "Download timed out after " + DownloadTimeout.String()
				job.CompletedAt = time.Now().Format(time.RFC3339)
				DbUpdateJob(job)
				log.Printf("[download] Timed out after %v for %q", DownloadTimeout, job.SearchQuery)
				return false
			}
			if cmdErr2 == nil {
				noteCookieFailure()
				log.Printf("[download] cookieless retry succeeded for %q — disabling cookies for %v", job.SearchQuery, cookieFailCooldown)
			} else {
				if isYtdlp403(out2) {
					noteBotBlock()
				}
				job.Status = "failed"
				job.Error = userFriendlyError(out2)
				job.CompletedAt = time.Now().Format(time.RFC3339)
				DbUpdateJob(job)
				log.Printf("[download] yt-dlp failed for %q (with and without cookies): %v", job.SearchQuery, cmdErr2)
				return false
			}
		} else {
			job.Status = "failed"
			job.Error = userFriendlyError(out)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			log.Printf("[download] yt-dlp failed for %q: %v", job.SearchQuery, cmdErr)
			return false
		}
	}

	finalizeDownload(job, FindDownloadedFile(destDir, safeTitle), 0)
	return true
}

// downloadFromSoulseek runs the Soulseek flow (auto-pick only; manual picks go
// through ProcessSlskSelection). It searches, auto-selects on a strong match
// and downloads that exact candidate by username+filename, else surfaces the
// picker by populating CandidatesJSON.
func downloadFromSoulseek(job *DownloadJob) {
	if findSlsk() == "" || slskScriptPath() == "" {
		job.Status = "failed"
		job.Error = "Soulseek unavailable (python3 or script missing)"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}
	if store.GetSetting("slsk_username", "") == "" || store.GetSetting("slsk_password", "") == "" {
		job.Status = "failed"
		job.Error = "Soulseek credentials not configured"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	// Auto-pick path: search and either auto-download a strong match or surface
	// the existing picker by populating CandidatesJSON in the UI shape.
	job.Status = "searching"
	job.Source = "soulseek"
	job.ProgressStage = "Searching Soulseek"
	DbUpdateJob(job)

	cands, serr := searchSlsk(slskQuery(job))
	if serr != nil {
		job.Status = "failed"
		job.Error = "Soulseek search failed: " + serr.Error()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] soulseek search failed for %q: %v", job.SearchQuery, serr)
		return
	}

	if len(cands) > 0 {
		job.ProgressStage = fmt.Sprintf("Found %d results, matching", len(cands))
		DbUpdateJob(job)
	}

	// H2: match against the cleaned title (parentheticals stripped) the same way
	// slskQuery builds the search, so "Money (Remastered 2011)" still matches the
	// "Money" results the search actually returned.
	minBr := store.GetSettingInt("slsk_min_bitrate", 0)
	pickIdx, pickOK := autoPickSlsk(cands, job.Artist, slskCleanTitle(job.Title), job.Title, minBr)
	if !pickOK {
		if len(cands) > 0 {
			// ponytail: only surface strong (artist+title-in-filename) matches to
			// the picker — dumping every raw search result floods the modal with
			// unrelated songs. autoPickSlsk already passed over these on quality
			// gates; show them so the user can override, but never show non-matches.
			strong := make([]slskRawCandidate, 0, len(cands))
			for _, c := range cands {
				if slskStrongMatch(c, job.Artist, slskCleanTitle(job.Title)) {
					strong = append(strong, c)
				}
			}
			if len(strong) == 0 {
				job.Status = "failed"
				job.Error = "No matching Soulseek results (try Search Again)"
				job.CompletedAt = time.Now().Format(time.RFC3339)
				DbUpdateJob(job)
				log.Printf("[download] no strong Soulseek match for %q among %d results", job.SearchQuery, len(cands))
				return
			}
			if len(strong) > 8 {
				strong = strong[:8]
			}
			candJSON, jerr := slskCandidatesToJSON(strong)
			if jerr != nil {
				job.Status = "failed"
				job.Error = "Failed to encode Soulseek candidates: " + jerr.Error()
				job.CompletedAt = time.Now().Format(time.RFC3339)
				DbUpdateJob(job)
				return
			}
			job.CandidatesJSON = candJSON
			job.Status = "needs_selection"
			job.Source = "soulseek"
			job.ProgressStage = "Awaiting user selection"
			DbUpdateJob(job)
			log.Printf("[download] %d strong Soulseek matches for %q need user pick", len(strong), job.SearchQuery)
			return
		}
		job.Status = "failed"
		job.Error = "No Soulseek results"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	// Build multi-candidate list. Include ALL candidates (not just strong
	// matches) ranked by size/quality. autoPickSlsk's pick is first, then
	// strong matches, then others. Peers are frequently unreachable behind
	// NAT/firewall, so trying multiple improves success rate dramatically.
	type dlCand struct {
		Username string `json:"username"`
		Filename string `json:"filename"`
		Size     int64  `json:"size,omitempty"`
	}
	displayName := ""
	// Pick the autoPick first, then strong matches, then everything else.
	var ordered []slskRawCandidate
	picked := false
	for _, c := range cands {
		if c.Index == pickIdx {
			ordered = append([]slskRawCandidate{c}, ordered...)
			displayName = c.Username
			picked = true
		} else if slskStrongMatch(c, job.Artist, slskCleanTitle(job.Title)) {
			ordered = append(ordered, c)
		}
	}
	// If autoPick wasn't in cands (shouldn't happen), still proceed
	if !picked {
		for _, c := range cands {
			if c.Index == pickIdx {
				ordered = append([]slskRawCandidate{c}, ordered...)
				displayName = c.Username
				break
			}
		}
	}
	// Prefer known-fast peers: stable-sort everything EXCEPT the autoPick
	// winner (idx 0) by descending reputation. Unknown peers rank equally
	// (0) and keep their existing order, so this never overrides the quality
	// pick — it only reorders the fallback queue so faster peers are tried
	// before slower ones. ponytail: stall_timeout (30s) still cuts anyone
	// who stalls; this just avoids burning that budget on slow peers first.
	if len(ordered) > 2 {
		ranking := slskSpeedRanking(slskCandidateUsernames(ordered[1:]))
		sort.SliceStable(ordered[1:], func(i, j int) bool {
			return ranking[ordered[1+i].Username] > ranking[ordered[1+j].Username]
		})
	}
	// Only try strong matches — non-strong candidates risk downloading
	// completely wrong songs.
	// Cap at 8 candidates
	maxCands := 8
	if len(ordered) > maxCands {
		ordered = ordered[:maxCands]
	}
	topCands := make([]dlCand, len(ordered))
	// Map winning filename → candidate's self-reported duration so we can pass
	// an expected length into finalizeDownload's truncation check. Zero/unknown
	// candidates map to 0 (check is skipped).
	expectedDurByFile := make(map[string]int, len(ordered))
	for i, c := range ordered {
		topCands[i] = dlCand{Username: c.Username, Filename: c.Filename, Size: c.Size}
		if c.Duration != nil && *c.Duration > 0 {
			expectedDurByFile[c.Filename] = *c.Duration
		}
	}
	candListJSON, _ := json.Marshal(topCands)

	job.Status = "downloading"
	job.Source = "soulseek"
	job.ProgressStage = "Downloading from " + displayName
	DbUpdateJob(job)

	audioFile, peer, err := runSlskDownloadMulti(job, string(candListJSON), displayName)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] soulseek download failed for %q: %v", job.SearchQuery, err)
		return
	}
	expected := expectedDurByFile[peer.Filename]
	if finalizeDownload(job, audioFile, expected) && peer.Username != "" {
		recordSlskSpeed(peer.Username, peer.BytesPerSec)
	}
}

func SearchYouTubeWithTimeout(query, expectedArtist, expectedTitle string, timeout time.Duration) ([]YTSearchCandidate, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	candidates, err := SearchYouTubeScored(ctx, query, expectedArtist, expectedTitle)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("search timed out after %v", timeout)
		}
		return nil, err
	}
	return candidates, nil
}

type YTSearchCandidate struct {
	VideoID  string  `json:"videoId"`
	Title    string  `json:"title"`
	Channel  string  `json:"channel"`
	Duration int     `json:"duration"`
	Score    float64 `json:"score"`
}

func SearchYouTubeScored(ctx context.Context, query, expectedArtist, expectedTitle string) ([]YTSearchCandidate, error) {
	ytdlpPath := FindYtDlp()
	if ytdlpPath == "" {
		return nil, fmt.Errorf("yt-dlp not found")
	}

	sleepIfBotted()

	cmd := exec.CommandContext(ctx, ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		fmt.Sprintf("ytsearch10:%s", query),
	)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp search failed: %w", err)
	}

	musicOutput, musicErr := exec.CommandContext(ctx, ytdlpPath,
		"--dump-json",
		"--flat-playlist",
		"--no-warnings",
		"--playlist-end", "5",
		"https://music.youtube.com/search?q="+url.QueryEscape(query),
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
	var deduped []rawResult
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

// cleanupFailedDownload removes any audio files + yt-dlp temp artifacts in dir
// matching safeTitle. Called before a Soulseek fallback so the two downloads
// don't leave duplicate files.
func cleanupFailedDownload(dir, safeTitle string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	stem := strings.ToLower(safeTitle)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		// H7: only delete files whose stem EXACTLY matches safeTitle (not prefix)
		// plus known partial-file suffixes.
		fileStem := strings.TrimSuffix(lower, filepath.Ext(lower))
		if fileStem == stem ||
			strings.HasSuffix(lower, ".part") ||
			strings.HasSuffix(lower, ".tmp") ||
			strings.HasSuffix(lower, ".incomplete") ||
			strings.HasSuffix(lower, ".ytdl") {
			os.Remove(filepath.Join(dir, name))
		}
	}
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

func ValidateAudioIntegrity(filePath string) (bool, string, float64) {
	ffprobePath, _ := exec.LookPath("ffprobe")
	if ffprobePath == "" {
		return true, "", 0
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration,size:stream=codec_type",
		"-of", "json",
		filePath,
	)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Sprintf("ffprobe failed: %v", err), 0
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
		return false, "invalid probe output", 0
	}

	hasAudio := false
	for _, s := range info.Streams {
		if s.CodecType == "audio" {
			hasAudio = true
		}
	}
	if !hasAudio {
		return false, "no audio stream found", 0
	}

	if info.Format.Duration == "" || info.Format.Duration == "N/A" {
		return false, "no duration", 0
	}
	dur, err := strconv.ParseFloat(info.Format.Duration, 64)
	if err != nil || dur <= 0 {
		return false, "invalid duration", 0
	}
	if dur < 10 {
		return false, fmt.Sprintf("duration too short: %.0fs (likely truncated)", dur), 0
	}

	return true, "", dur
}

func TagAudioFile(filePath, artist, title, album string, trackNum, trackTotal int) {
	ffmpegPath, _ := exec.LookPath("ffmpeg")
	if ffmpegPath == "" {
		return
	}

	tmpFile := filePath + ".tagged" + filepath.Ext(filePath)

	args := []string{"-y", "-i", filePath,
		"-metadata", fmt.Sprintf("artist=%s", artist),
		"-metadata", fmt.Sprintf("title=%s", title),
		"-metadata", fmt.Sprintf("album=%s", album),
	}
	if trackNum > 0 {
		trackVal := fmt.Sprintf("%d", trackNum)
		if trackTotal > 0 {
			trackVal = fmt.Sprintf("%d/%d", trackNum, trackTotal)
		}
		args = append(args, "-metadata", fmt.Sprintf("track=%s", trackVal))
	}
	args = append(args, "-c", "copy", tmpFile)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	if err := cmd.Run(); err != nil {
		log.Printf("[download] WARNING: tag write failed for %s: %v", filePath, err)
		os.Remove(tmpFile)
		return
	}

	info, err := os.Stat(tmpFile)
	if err != nil || info.Size() == 0 {
		os.Remove(tmpFile)
		return
	}

	if err := os.Rename(tmpFile, filePath); err != nil {
		log.Printf("[download] WARNING: tag rename failed %s -> %s: %v", tmpFile, filePath, err)
		os.Remove(tmpFile)
	}
}

func SanitizeFilename(name string) string {
	return scanner.SanitizePath(name)
}

func ProbeAudioQuality(filePath string) string {
	ffprobePath, _ := exec.LookPath("ffprobe")
	if ffprobePath == "" {
		return ""
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath,
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

// orphanReset resets jobs stuck in active states that have no running command.
// Called from the watchdog (every 2 min) to recover jobs orphaned by panics,
// crashes, or process kills that left the status without updating it.
func orphanReset() {
	DownloadMu.Lock()
	activeIDs := make(map[string]bool, len(ActiveJobs))
	for id := range ActiveJobs {
		activeIDs[id] = true
	}
	DownloadMu.Unlock()

	stuck := []string{"searching", "downloading", "tagging"}
	for _, status := range stuck {
		rows, err := store.DB.Query("SELECT id FROM download_jobs WHERE status = ?", status)
		if err != nil {
			continue
		}
		var orphans []string
		for rows.Next() {
			var id string
			rows.Scan(&id)
			if !activeIDs[id] {
				orphans = append(orphans, id)
			}
		}
		rows.Close()
		for _, id := range orphans {
			store.DB.Exec("UPDATE download_jobs SET status='queued', progress_stage='' WHERE id=?", id)
			log.Printf("[download-watchdog] Reset orphaned job %s from %s to queued", id, status)
		}
	}
}

func RecoverStalledDownloads() {
	stalled := []string{"searching", "downloading", "tagging"}
	for _, status := range stalled {
		// M5: if a job's file already exists on disk, mark it completed instead of re-queuing.
		rows, err := store.DB.Query("SELECT id, file_path FROM download_jobs WHERE status = ?", status)
		if err == nil {
			var completedIDs []string
			for rows.Next() {
				var id, fp string
				rows.Scan(&id, &fp)
				if fp != "" {
					if _, statErr := os.Stat(fp); statErr == nil {
						completedIDs = append(completedIDs, id)
					}
				}
			}
			rows.Close()
			for _, id := range completedIDs {
				store.DB.Exec("UPDATE download_jobs SET status = 'completed', progress_stage = '', error = '' WHERE id = ?", id)
				log.Printf("[download] Recovered stalled job %s as completed (file exists on disk)", id)
			}
		}
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
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[download-watchdog] panic recovered: %v\n%s", r, debug.Stack())
				}
				store.WorkerDone("download-watchdog", nil)
			}()
			store.WorkerStart("download-watchdog")

			DownloadMu.Lock()
			now := time.Now()
			for jobID, startTime := range ActiveJobTime {
				if now.Sub(startTime) > DownloadTimeout+time.Minute {
					if cmd, ok := ActiveJobs[jobID]; ok && cmd.Process != nil {
						log.Printf("[download-watchdog] Killing stalled job %s (running %v)", jobID, now.Sub(startTime))
						cmd.Process.Kill()
					}
					// H11: remove the killed job so the watchdog doesn't re-kill
					// it every tick forever. The owning runDownloadCmd/runSlskDownload
					// defer also cleans up, but those may be blocked on the killed
					// process's IO; clearing here is belt-and-suspenders.
					delete(ActiveJobs, jobID)
					delete(ActiveJobTime, jobID)
				}
			}
			DownloadMu.Unlock()

			// Reset orphaned jobs: stuck in searching/downloading/tagging with
			// no active command processing them. This happens when a goroutine
			// exits (panic, crash) without updating the job status.
			orphanReset()

			jobs, _ := DbGetQueuedJobs()
			if len(jobs) > 0 {
				DownloadMu.Lock()
				active := DownloadActive
				DownloadMu.Unlock()
				if active < MaxConcurrentDownloads() {
					store.SafeGo("process-queue", func() { ProcessDownloadQueue() })
				}
			}
		}()
	}
}

func userFriendlyError(output string) string {
	out := strings.ToLower(output)
	switch {
	case strings.Contains(out, "sign in to confirm your age") || strings.Contains(out, "age-restricted"):
		return "Age-restricted video — add YouTube cookies in Settings to download"
	case strings.Contains(out, "sign in to confirm you're not a bot") || strings.Contains(out, "not a bot") || strings.Contains(out, "forbidden") || strings.Contains(out, "403"):
		return "YouTube blocked the request (403) — add cookies in Settings, or try another Player Client"
	case strings.Contains(out, "private video"):
		return "Private video — not downloadable"
	case strings.Contains(out, "video unavailable"):
		return "Video unavailable — it may be private, deleted, or region-restricted"
	case strings.Contains(out, "http error 429") || strings.Contains(out, "too many requests"):
		return "YouTube rate limit (429) — try again later"
	case strings.Contains(out, "requested format is not available") || strings.Contains(out, "format is not available"):
		return "Requested audio format unavailable — cookies may be stale; re-export them in Settings"
	case strings.Contains(out, "unable to extract") || strings.Contains(out, "failed to extract"):
		return "YouTube metadata extraction failed — site may have changed; try updating yt-dlp"
	case strings.Contains(out, "unable to download webpage") || strings.Contains(out, "timed out"):
		return "Network error or timeout — check connection and retry"
	case strings.Contains(out, "yt-dlp not found"):
		return "yt-dlp not installed"
	}
	if len(output) > 200 {
		return strings.TrimSpace(output[:200])
	}
	return strings.TrimSpace(output)
}