package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"musicapp/internal/auth"
	"musicapp/internal/models"
	"musicapp/internal/review"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"musicapp/internal/transcode"
)

// ── Weekly playback-failure log ─────────────────────────────────────────────
//
// Every player-side playback failure (load timeout, decode error, rejected
// play) is appended to data/playback-failures-<year>-W<week>.jsonl, one JSON
// object per line, enriched server-side with track stats and transcode-cache
// state. A new file starts each ISO week; older files are deleted on write.

var playbackLogMu sync.Mutex

func playbackFailureLogPath() string {
	y, w := time.Now().ISOWeek()
	return filepath.Join(filepath.Dir(store.DBPath), fmt.Sprintf("playback-failures-%d-W%02d.jsonl", y, w))
}

type playbackFailureEntry struct {
	Time string `json:"time"`
	User string `json:"user,omitempty"`
	UA   string `json:"ua,omitempty"`

	TrackID   string `json:"trackId"`
	Title     string `json:"title,omitempty"`
	Artist    string `json:"artist,omitempty"`
	Album     string `json:"album,omitempty"`
	Format    string `json:"format,omitempty"`
	DurationS int    `json:"durationSec,omitempty"`
	Bytes     int64  `json:"bytes,omitempty"`

	Reason      string `json:"reason"` // load-timeout | audio-error | play-rejected
	ErrCode     int    `json:"errCode,omitempty"`
	ErrMsg      string `json:"errMsg,omitempty"`
	NetState    int    `json:"netState,omitempty"`
	ReadyState  int    `json:"readyState,omitempty"`
	WantsAac    bool   `json:"wantsAac"`            // client requested ?fmt=aac
	AacCached   bool   `json:"aacCached"`           // transcode cache was fresh at failure time
	TranscodeOn bool   `json:"transcodeSettingOn"`  // server transcode_enabled setting
}

func appendPlaybackFailure(e playbackFailureEntry) {
	playbackLogMu.Lock()
	defer playbackLogMu.Unlock()

	path := playbackFailureLogPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("[playback-log] mkdir: %v", err)
		return
	}
	line, err := json.Marshal(e)
	if err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		log.Printf("[playback-log] open: %v", err)
		return
	}
	f.Write(append(line, '\n'))
	f.Close()

	// Weekly rotation: keep only the current week's file.
	dir := filepath.Dir(path)
	cur := filepath.Base(path)
	if entries, err := os.ReadDir(dir); err == nil {
		for _, en := range entries {
			n := en.Name()
			if strings.HasPrefix(n, "playback-failures-") && strings.HasSuffix(n, ".jsonl") && n != cur {
				os.Remove(filepath.Join(dir, n))
			}
		}
	}
}

// PlaybackFailuresLogHandler serves the current week's playback-failure log
// (GET /api/admin/playback-failures). One JSON object per line.
func PlaybackFailuresLogHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	data, err := os.ReadFile(playbackFailureLogPath())
	if err != nil {
		data = nil // no failures logged this week
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

// TrackPlaybackErrorHandler receives a browser-reported playback failure for a
// track. Two effects, deliberately separated:
//
//  1. EVERY report is appended to the weekly playback-failure log (all reasons
//     — timeouts and rejected plays never flag anything, but the user wants
//     them logged for diagnosis).
//  2. Only file-intrinsic HTMLMedia error codes flag the track for review:
//     3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED. Code 2 (network)
//     is transient and never flags.
//
// Error codes (HTMLMediaElement.error.code): 2 = network, 3 = decode,
// 4 = src-not-supported. Timeout/play-rejection reports carry code 0.
func TrackPlaybackErrorHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimPrefix(r.URL.Path, "/api/playback-error/")
	if trackID == "" {
		http.Error(w, `{"error":"track id required"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Code        int    `json:"code"`
		Reason      string `json:"reason"`
		Message     string `json:"message"`
		NetworkState int   `json:"networkState"`
		ReadyState  int    `json:"readyState"`
		WantsAac    bool   `json:"transcode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	var snapshot models.Track
	if exists {
		snapshot = *track
	}
	store.Mu.RUnlock()

	// 1) Log every failure with full context.
	entry := playbackFailureEntry{
		Time:       time.Now().UTC().Format(time.RFC3339),
		TrackID:    trackID,
		Reason:     body.Reason,
		ErrCode:    body.Code,
		ErrMsg:     body.Message,
		NetState:   body.NetworkState,
		ReadyState: body.ReadyState,
		WantsAac:   body.WantsAac,
	}
	if u := auth.CurrentUser(r); u != nil {
		entry.User = u.Username
	}
	entry.UA = r.UserAgent()
	if exists {
		entry.Title = snapshot.Title
		entry.Artist = snapshot.Artist
		entry.Album = snapshot.Album
		entry.DurationS = snapshot.Duration
		fullPath := scanner.ResolveFilePath(snapshot.FilePath)
		entry.Format = strings.ToLower(filepath.Ext(fullPath))
		if fi, err := os.Stat(fullPath); err == nil {
			entry.Bytes = fi.Size()
		}
		if needsTranscode(entry.Format) {
			entry.AacCached = transcode.IsReady(trackID, fullPath)
		}
	}
	entry.TranscodeOn = store.GetSettingBool("transcode_enabled", true)
	appendPlaybackFailure(entry)

	// 2) Flag genuinely unplayable files (codes 3/4 only).
	if body.Code != 3 && body.Code != 4 {
		writeJSON(w, map[string]bool{"ok": true})
		return
	}
	if !exists {
		http.NotFound(w, r)
		return
	}

	// Merge playback_error into existing flags (don't clobber other flags, and
	// don't down-grade a track that's already needs_review with richer context).
	_, flags := review.DbGetReviewForTrack(trackID)
	has := false
	for _, f := range flags {
		if f == "playback_error" {
			has = true
			break
		}
	}
	if !has {
		flags = append(flags, "playback_error")
	}
	flagsJSON, _ := json.Marshal(flags)
	review.DbSetReviewStatus(trackID, "needs_review", string(flagsJSON), "playback")

	store.Mu.Lock()
	if t, ok := store.Tracks[trackID]; ok {
		t.ReviewStatus = "needs_review"
		t.ReviewFlags = flags
	}
	store.Mu.Unlock()

	writeJSON(w, map[string]bool{"ok": true})
}
