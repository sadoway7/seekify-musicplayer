package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func downloadHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/download/")

	store.Mu.RLock()
	track, exists := store.Tracks[id]
	store.Mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	if !store.GetSettingBool("downloads_enabled", true) {
		http.Error(w, "Downloads are disabled", http.StatusForbidden)
		return
	}

	fullPath := resolveFilePath(track.FilePath)
	file, err := os.Open(fullPath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "Could not stat file", http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(fullPath))
	contentType := store.AudioExtensions[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Build a friendly filename: Artist - Title.ext
	filename := filepath.Base(fullPath)
	if track.Artist != "" && track.Title != "" {
		filename = sanitizePath(track.Artist) + " - " + sanitizePath(track.Title) + ext
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	http.ServeContent(w, r, filename, stat.ModTime(), file)
}

func downloadsListHandler(w http.ResponseWriter, r *http.Request) {
	store.Mu.RLock()
	defer store.Mu.RUnlock()

	type downloadTrack struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Artist  string `json:"artist"`
		Album   string `json:"album"`
		Enabled bool   `json:"enabled"`
	}

	var result []downloadTrack
	for _, t := range store.Tracks {
		result = append(result, downloadTrack{
			ID:      t.ID,
			Title:   t.Title,
			Artist:  t.Artist,
			Album:   t.Album,
			Enabled: t.DownloadEnabled,
		})
	}

	if result == nil {
		result = []downloadTrack{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func downloadToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trackID := strings.TrimPrefix(r.URL.Path, "/api/admin/download-toggle/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	store.Mu.RLock()
	_, exists := store.Tracks[trackID]
	store.Mu.RUnlock()

	if !exists {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	enabled := store.DbToggleDownload(trackID)

	store.Mu.Lock()
	if t, ok := store.Tracks[trackID]; ok {
		t.DownloadEnabled = enabled
	}
	store.Mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"enabled": enabled})
}

func downloadsEnableAllHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	store.DbEnableAllDownloads()
	store.Mu.Lock()
	for _, t := range store.Tracks {
		t.DownloadEnabled = true
	}
	store.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func downloadQueueHandler(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}

	jobs, err := dbGetJobs(limit)
	if err != nil {
		http.Error(w, `{"error":"failed to load jobs"}`, http.StatusInternalServerError)
		return
	}
	if jobs == nil {
		jobs = []DownloadJob{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func downloadQueueAddHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Query       string `json:"query"`
		Artist      string `json:"artist"`
		Title       string `json:"title"`
		Album       string `json:"album"`
		AlbumMBID   string `json:"albumMbid"`
		TrackNum    int    `json:"trackNumber"`
		TrackTotal  int    `json:"trackTotal"`
		OverrideDir string `json:"overrideDir"`
		Pipeline    string `json:"pipeline"`
		RecordingID string `json:"recordingId"`
		ReleaseID   string `json:"releaseId"`
		ArtistID    string `json:"artistId"`
		Genre       string `json:"genre"`
		Year        string `json:"year"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	job, err := createDownloadJob(
		req.Query, req.Artist, req.Title, req.Album,
		req.AlbumMBID, req.TrackNum, req.TrackTotal, req.OverrideDir, "",
	)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "already in library") {
			status = http.StatusConflict
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if req.Pipeline == "v2" {
		job.Pipeline = "v2"
		job.RecordingID = req.RecordingID
		job.ReleaseID = req.ReleaseID
		job.ArtistID = req.ArtistID
		job.Genre = req.Genre
		job.Year = req.Year
		dbUpdateJob(job)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadQueueAddBatchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Tracks []struct {
			Artist     string `json:"artist"`
			Title      string `json:"title"`
			Album      string `json:"album"`
			AlbumMBID  string `json:"albumMbid"`
			TrackNum   int    `json:"trackNumber"`
			TrackTotal int    `json:"trackTotal"`
		} `json:"tracks"`
		OverrideDir string `json:"overrideDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	var jobs []*DownloadJob
	for _, t := range req.Tracks {
		query := ""
		if t.Artist != "" && t.Title != "" {
			query = t.Artist + " - " + t.Title
		} else if t.Title != "" {
			query = t.Title
		}

		job, err := createDownloadJob(
			query, t.Artist, t.Title, t.Album,
			t.AlbumMBID, t.TrackNum, t.TrackTotal, req.OverrideDir, "",
		)
		if err != nil {
			log.Printf("[download] Failed to create job for %q: %v", query, err)
			continue
		}
		jobs = append(jobs, job)
		time.Sleep(100 * time.Millisecond)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func downloadJobStatusHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadJobRetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	id = strings.TrimSuffix(id, "/retry")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	job.Status = "queued"
	job.Error = ""
	job.ProgressStage = ""
	job.CompletedAt = ""
	dbUpdateJob(job)

	go processDownloadQueue()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadJobDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" && r.Method != "DELETE" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	id = strings.TrimSuffix(id, "/delete")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	store.DB.Exec("DELETE FROM download_jobs WHERE id = ?", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func downloadJobSelectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	id = strings.TrimSuffix(id, "/select")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil || job.Status != "needs_selection" {
		http.Error(w, `{"error":"job not found or not awaiting selection"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		VideoID string `json:"videoId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.VideoID == "" {
		http.Error(w, `{"error":"missing videoId"}`, http.StatusBadRequest)
		return
	}

	job.VideoID = req.VideoID
	job.Status = "queued"
	job.CandidatesJSON = ""
	job.ProgressStage = ""
	job.Error = ""
	dbUpdateJob(job)

	go processDownloadQueue()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func downloadJobFileHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/download-job/")
	if id == "" {
		http.Error(w, "missing job id", http.StatusBadRequest)
		return
	}

	job, err := dbGetJob(id)
	if err != nil || job.FilePath == "" {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(job.FilePath)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer f.Close()

	stat, _ := f.Stat()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(job.FilePath)))
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	io.Copy(w, f)
}

func queueClearCompletedHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	result, err := store.DB.Exec("DELETE FROM download_jobs WHERE status NOT IN ('queued', 'downloading')")
	cleared := 0
	if err == nil {
		affected, _ := result.RowsAffected()
		cleared = int(affected)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"cleared": cleared})
}

func queueCountsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dbGetJobCounts())
}

func previewAudioHandler(w http.ResponseWriter, r *http.Request) {
	videoID := strings.TrimPrefix(r.URL.Path, "/api/preview/")
	if videoID == "" {
		http.Error(w, `{"error":"missing video id"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath := findYtDlp()
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not available"}`, http.StatusServiceUnavailable)
		return
	}

	cmd := exec.Command(ytdlpPath,
		"-f", "bestaudio[protocol=https]/bestaudio/best",
		"-g", "--no-warnings",
		fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID),
	)
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, `{"error":"could not resolve stream"}`, http.StatusInternalServerError)
		return
	}

	streamURL := strings.TrimSpace(strings.Split(string(output), "\n")[0])
	if streamURL == "" {
		http.Error(w, `{"error":"no stream url"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": streamURL, "videoId": videoID})
}
