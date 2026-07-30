package normalize

import (
	"fmt"
	"log"
	"math"
	"musicapp/internal/downloads"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// normSem bounds concurrent ffmpeg ebur128 analyses (mirrors waveSem in
// internal/waveform).
var normSem = make(chan struct{}, 2)

var (
	pendingMu      sync.Mutex
	pending        = make(map[string]bool)
	uncomputableMu sync.Mutex
	uncomputable   = make(map[string]bool)
)

var ilineRe = regexp.MustCompile(`(?m)^\s*I:\s*(-?\d+(?:\.\d+)?)\s+LUFS`)

// parseIntegratedLufs extracts the LAST "I: <value> LUFS" summary value from
// ffmpeg ebur128 stderr output.
func parseIntegratedLufs(stderr string) (float64, error) {
	matches := ilineRe.FindAllStringSubmatch(stderr, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("no integrated loudness value found")
	}
	v, err := strconv.ParseFloat(matches[len(matches)-1][1], 64)
	if err != nil {
		return 0, fmt.Errorf("parse I: value: %w", err)
	}
	return v, nil
}

// computeGainDb = clamp(target − I, −30, +12).
func computeGainDb(integratedLufs, targetLufs float64) float64 {
	g := targetLufs - integratedLufs
	return math.Max(-30, math.Min(12, g))
}

// getTargetLufs reads the configured target, defaulting to -14 on parse error.
func getTargetLufs() float64 {
	s := store.GetSetting("audio_normalization_target_lufs", "-14")
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return -14
	}
	return v
}

// GetCachedGain returns (gain_db, true) iff the track has a non-NULL gain_db.
func GetCachedGain(trackID string) (float64, bool) {
	var g float64
	err := store.DB.QueryRow(`SELECT gain_db FROM tracks WHERE id=? AND gain_db IS NOT NULL`, trackID).Scan(&g)
	if err != nil {
		return 0, false
	}
	return g, true
}

// IsUncomputable reports whether we've previously failed analysis for this track
// this session.
func IsUncomputable(trackID string) bool {
	uncomputableMu.Lock()
	defer uncomputableMu.Unlock()
	return uncomputable[trackID]
}

func markUncomputable(trackID string) {
	uncomputableMu.Lock()
	uncomputable[trackID] = true
	uncomputableMu.Unlock()
}

// ComputeAsync dedupes and runs analysis in the background. No-op if cached,
// uncomputable, or already in-flight. Semaphore-bounded via normSem.
func ComputeAsync(trackID string) {
	if _, ok := GetCachedGain(trackID); ok {
		return
	}
	if IsUncomputable(trackID) {
		return
	}
	pendingMu.Lock()
	if pending[trackID] {
		pendingMu.Unlock()
		return
	}
	pending[trackID] = true
	pendingMu.Unlock()

	store.SafeGo("normalize", func() {
		defer func() {
			pendingMu.Lock()
			delete(pending, trackID)
			pendingMu.Unlock()
		}()

		normSem <- struct{}{}
		defer func() { <-normSem }()

		store.Mu.RLock()
		track, exists := store.Tracks[trackID]
		store.Mu.RUnlock()
		if !exists {
			markUncomputable(trackID)
			return
		}

		fullPath := scanner.ResolveFilePath(track.FilePath)
		gainDb, err := analyzeOnce(fullPath)
		if err != nil {
			log.Printf("[normalize] %s: %v", trackID, err)
			markUncomputable(trackID)
			return
		}

		if _, err := store.DB.Exec(`UPDATE tracks SET gain_db=? WHERE id=?`, gainDb, trackID); err != nil {
			log.Printf("[normalize] persist %s: %v", trackID, err)
			return
		}
		log.Printf("[normalize] %s: gain_db=%.2f", trackID, gainDb)
	})
}

// analyzeOnce runs ffmpeg ebur128 on a file and returns computed gain_db.
func analyzeOnce(fullPath string) (float64, error) {
	ffmpeg := downloads.FindFfmpeg()
	if ffmpeg == "" {
		return 0, fmt.Errorf("ffmpeg not found")
	}
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-nostats",
		"-i", fullPath,
		"-af", "ebur128",
		"-f", "null", "-",
	)
	out, _ := cmd.CombinedOutput()
	i, err := parseIntegratedLufs(string(out))
	if err != nil {
		return 0, fmt.Errorf("parse: %w", err)
	}
	return computeGainDb(i, getTargetLufs()), nil
}
