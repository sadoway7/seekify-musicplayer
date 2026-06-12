package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"musicapp/internal/store"
	"os"
	"os/exec"
	"path/filepath"
)

const waveformMaxPeaks = 300

func generateWaveformPeaks(filePath string) ([]float64, error) {
	ffmpeg := findFfmpeg()
	if ffmpeg == "" {
		return nil, nil
	}

	cmd := exec.Command(ffmpeg,
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
	cmd.Wait()

	if len(samples) == 0 {
		return nil, nil
	}

	bucketSize := len(samples) / waveformMaxPeaks
	if bucketSize < 1 {
		bucketSize = 1
	}

	peaks := make([]float64, 0, waveformMaxPeaks)
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

		if len(peaks) >= waveformMaxPeaks {
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

func waveformDir() string {
	return filepath.Join(store.MusicDir, "images", "waveforms")
}

func waveformPath(trackID string) string {
	return filepath.Join(waveformDir(), trackID+".json")
}

func ensureWaveformDir() {
	os.MkdirAll(waveformDir(), 0755)
}

func getOrGenerateWaveform(trackID string) ([]float64, error) {
	path := waveformPath(trackID)
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

	fullPath := resolveFilePath(track.FilePath)
	peaks, err := generateWaveformPeaks(fullPath)
	if err != nil {
		log.Printf("[waveform] Failed to generate for %s: %v", trackID, err)
		return nil, err
	}
	if peaks == nil {
		return nil, nil
	}

	ensureWaveformDir()

	jsonData, _ := json.Marshal(struct {
		Peaks []float64 `json:"peaks"`
	}{Peaks: peaks})
	os.WriteFile(path, jsonData, 0644)

	log.Printf("[waveform] Generated and cached %d peaks for %s", len(peaks), trackID)
	return peaks, nil
}
