package waveform

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"musicapp/internal/downloads"
	"musicapp/internal/scanner"
	"musicapp/internal/store"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const WaveformMaxPeaks = 300

// waveSem bounds concurrent ffmpeg waveform generations to avoid forking an
// unbounded number of processes under heavy async load.
var waveSem = make(chan struct{}, 2)

var (
	pendingMu sync.Mutex
	pending   = make(map[string]bool)
)

func GenerateWaveformPeaks(filePath string) ([]float64, error) {
	ffmpeg := downloads.FindFfmpeg()
	if ffmpeg == "" {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-i", filePath,
		"-ac", "1",
		"-ar", "8000",
		"-f", "s16le",
		"-acodec", "pcm_s16le",
		"-",
	)
	cmd.Stderr = nil

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	const bufSize = 4096
	buf := make([]byte, bufSize)
	var samples []int16

	for {
		n, err := stdout.Read(buf)
		if n > 0 {
			for i := 0; i+1 < n; i += 2 {
				s := int16(binary.LittleEndian.Uint16(buf[i : i+2]))
				samples = append(samples, s)
			}
		}
		if err != nil {
			break
		}
	}
	waitErr := cmd.Wait()

	if len(samples) == 0 {
		if waitErr != nil {
			return nil, waitErr
		}
		return nil, nil
	}
	if waitErr != nil {
		log.Printf("[waveform] ffmpeg wait error (partial data used): %v", waitErr)
	}

	bucketSize := len(samples) / WaveformMaxPeaks
	if bucketSize < 1 {
		bucketSize = 1
	}

	peaks := make([]float64, 0, WaveformMaxPeaks)
	for i := 0; i < len(samples); i += bucketSize {
		end := i + bucketSize
		if end > len(samples) {
			end = len(samples)
		}

		var maxVal float64
		for j := i; j < end; j++ {
			v := math.Abs(float64(samples[j]))
			if v > maxVal {
				maxVal = v
			}
		}
		peaks = append(peaks, maxVal/32768.0)

		if len(peaks) >= WaveformMaxPeaks {
			break
		}
	}

	if len(peaks) == 0 {
		return nil, nil
	}

	maxPeak := 0.0
	for _, p := range peaks {
		if p > maxPeak {
			maxPeak = p
		}
	}
	if maxPeak > 0 {
		for i := range peaks {
			peaks[i] = peaks[i] / maxPeak
		}
	}

	return peaks, nil
}

func WaveformDir() string {
	return filepath.Join(store.MusicDir, "images", "waveforms")
}

func WaveformPath(trackID string) string {
	return filepath.Join(WaveformDir(), trackID+".json")
}

func EnsureWaveformDir() {
	os.MkdirAll(WaveformDir(), 0755)
}

func GetOrGenerateWaveform(trackID string) ([]float64, error) {
	path := WaveformPath(trackID)
	if data, err := os.ReadFile(path); err == nil {
		var result struct {
			Peaks []float64 `json:"peaks"`
		}
		if json.Unmarshal(data, &result) == nil && len(result.Peaks) > 0 {
			return result.Peaks, nil
		}
	}

	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		return nil, nil
	}

	fullPath := scanner.ResolveFilePath(track.FilePath)
	peaks, err := GenerateWaveformPeaks(fullPath)
	if err != nil {
		log.Printf("[waveform] Failed to generate for %s: %v", trackID, err)
		return nil, err
	}
	if peaks == nil {
		return nil, nil
	}

	EnsureWaveformDir()

	jsonData, _ := json.Marshal(struct {
		Peaks []float64 `json:"peaks"`
	}{Peaks: peaks})
	os.WriteFile(path, jsonData, 0644)

	log.Printf("[waveform] Generated and cached %d peaks for %s", len(peaks), trackID)
	return peaks, nil
}

func GetCachedWaveform(trackID string) ([]float64, error) {
	path := WaveformPath(trackID)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var result struct {
		Peaks []float64 `json:"peaks"`
	}
	if json.Unmarshal(data, &result) == nil && len(result.Peaks) > 0 {
		return result.Peaks, nil
	}
	return nil, nil
}

func IsPending(trackID string) bool {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	return pending[trackID]
}

func GenerateAsync(trackID string) {
	pendingMu.Lock()
	if pending[trackID] {
		pendingMu.Unlock()
		return
	}
	pending[trackID] = true
	pendingMu.Unlock()

	store.SafeGo("waveform", func() {
		defer func() {
			pendingMu.Lock()
			delete(pending, trackID)
			pendingMu.Unlock()
		}()

		waveSem <- struct{}{}
		defer func() { <-waveSem }()

		store.Mu.RLock()
		track, exists := store.Tracks[trackID]
		store.Mu.RUnlock()
		if !exists {
			return
		}

		fullPath := scanner.ResolveFilePath(track.FilePath)
		peaks, err := GenerateWaveformPeaks(fullPath)
		if err != nil || peaks == nil {
			return
		}

		EnsureWaveformDir()
		jsonData, _ := json.Marshal(struct {
			Peaks []float64 `json:"peaks"`
		}{Peaks: peaks})
		os.WriteFile(WaveformPath(trackID), jsonData, 0644)

		log.Printf("[waveform] Generated and cached %d peaks for %s", len(peaks), trackID)
	})
}
