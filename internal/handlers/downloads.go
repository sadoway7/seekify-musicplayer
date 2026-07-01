package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"musicapp/internal/downloads"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func DownloadHandler(w http.ResponseWriter, r *http.Request) {
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

	fullPath := scanner.ResolveFilePath(track.FilePath)
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
		filename = scanner.SanitizePath(track.Artist) + " - " + scanner.SanitizePath(track.Title) + ext
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	http.ServeContent(w, r, filename, stat.ModTime(), file)
}

func DownloadsListHandler(w http.ResponseWriter, r *http.Request) {
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

func DownloadToggleHandler(w http.ResponseWriter, r *http.Request) {
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

func DownloadsEnableAllHandler(w http.ResponseWriter, r *http.Request) {
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

func DownloadQueueHandler(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}

	jobs, err := downloads.DbGetJobs(limit)
	if err != nil {
		http.Error(w, `{"error":"failed to load jobs"}`, http.StatusInternalServerError)
		return
	}
	if jobs == nil {
		jobs = []downloads.DownloadJob{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func DownloadQueueAddHandler(w http.ResponseWriter, r *http.Request) {
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

	job, err := downloads.CreateDownloadJob(
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
		downloads.DbUpdateJob(job)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func DownloadQueueAddBatchHandler(w http.ResponseWriter, r *http.Request) {
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

	var jobs []*downloads.DownloadJob
	for _, t := range req.Tracks {
		query := ""
		if t.Artist != "" && t.Title != "" {
			query = t.Artist + " - " + t.Title
		} else if t.Title != "" {
			query = t.Title
		}

		job, err := downloads.CreateDownloadJob(
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

func DownloadJobStatusHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/queue/")
	if id == "" {
		http.Error(w, `{"error":"missing job id"}`, http.StatusBadRequest)
		return
	}

	job, err := downloads.DbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func DownloadJobRetryHandler(w http.ResponseWriter, r *http.Request) {
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

	job, err := downloads.DbGetJob(id)
	if err != nil {
		http.Error(w, `{"error":"job not found"}`, http.StatusNotFound)
		return
	}

	job.Status = "queued"
	job.Error = ""
	job.ProgressStage = ""
	job.CompletedAt = ""
	downloads.DbUpdateJob(job)

	store.SafeGo("process-queue", func() { downloads.ProcessDownloadQueue() })

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func DownloadJobDeleteHandler(w http.ResponseWriter, r *http.Request) {
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

func DownloadJobSelectHandler(w http.ResponseWriter, r *http.Request) {
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

	job, err := downloads.DbGetJob(id)
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
	downloads.DbUpdateJob(job)

	if job.Source == "soulseek" {
		idx, err := strconv.Atoi(req.VideoID)
		if err != nil || idx < 0 {
			http.Error(w, `{"error":"invalid selection index"}`, http.StatusBadRequest)
			return
		}
		store.SafeGo("slsk-selection", func() { downloads.ProcessSlskSelection(job, idx) })
	} else {
		store.SafeGo("process-queue", func() { downloads.ProcessDownloadQueue() })
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func DownloadJobFileHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/download-job/")
	if id == "" {
		http.Error(w, "missing job id", http.StatusBadRequest)
		return
	}

	job, err := downloads.DbGetJob(id)
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

func QueueClearCompletedHandler(w http.ResponseWriter, r *http.Request) {
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

func QueueCountsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(downloads.DbGetJobCounts())
}

func PreviewAudioHandler(w http.ResponseWriter, r *http.Request) {
	videoID := strings.TrimPrefix(r.URL.Path, "/api/preview/")
	if videoID == "" {
		http.Error(w, `{"error":"missing video id"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath := downloads.FindYtDlp()
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not available"}`, http.StatusServiceUnavailable)
		return
	}

	cmd := exec.Command(ytdlpPath,
		append(downloads.YtCommonArgs(),
			"-f", "bestaudio[protocol=https]/bestaudio/best",
			"-g", "--no-warnings",
			fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID),
		)...)
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

// SoulseekConnectHandler implements the one-click "Connect Soulseek" onboarding.
// It persists the provided credentials, ensures + seeds the share folder, then
// runs a login smoke test. A successful login also flips slsk_enabled on.
func SoulseekConnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		ShareDir string `json:"share_dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		http.Error(w, `{"error":"username and password required"}`, http.StatusBadRequest)
		return
	}

	store.SetSetting("slsk_username", req.Username)
	store.SetSetting("slsk_password", req.Password)
	if req.ShareDir != "" {
		store.SetSetting("slsk_share_dir", req.ShareDir)
	}

	shareDir := req.ShareDir
	if shareDir == "" {
		shareDir = store.GetSetting("slsk_share_dir", "")
	}
	if shareDir == "" {
		shareDir = downloads.SlskShareDir()
	}
	if err := os.MkdirAll(shareDir, 0755); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "could not create share folder: " + err.Error()})
		return
	}

	seeded, err := downloads.SeedSlskShare(shareDir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "could not access share folder: " + err.Error()})
		return
	}

	ok, msg, terr := downloads.TestSlskConnection(req.Username, req.Password, shareDir)
	if terr != nil {
		log.Printf("[soulseek] connect test error: %v", terr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": terr.Error()})
		return
	}

	if ok {
		store.SetSetting("slsk_enabled", "true")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":        true,
			"message":   "Connected — account created if it was new",
			"share_dir": shareDir,
			"seeded":    seeded,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        false,
		"message":   msg,
		"share_dir": shareDir,
		"seeded":    seeded,
	})
}
