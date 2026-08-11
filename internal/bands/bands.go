package bands

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
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// Per-track precomputed frequency-band timeline, consumed by the client
// visualizer on browsers that can't tap live audio without breaking AirPlay
// (iOS Safari: no captureStream; createMediaElementSource kills AirPlay).
// The visualizer reads this timeline synced to Player.audio.currentTime, so it
// pulses to the music with NO client-side AudioContext -> AirPlay stays intact.

const (
	sampleRate    = 22050 // Hz, mono. Nyquist 11 kHz covers the treble band (<=8 kHz).
	fftSize       = 1024  // matches the visualizer's analyser fftSize
	hop           = 512   // 50% overlap
	targetBandsPS = 20    // timeline buckets per second (50 ms each)
)

// bandEdges are the Hz boundaries of the 4 bands. These match the visualizer's
// analyser bin ranges at ~44.1 kHz (bass bins 0-12, midLow 13-39, midHigh 40-72,
// treble 73-183; bin width ~43 Hz -> 0-560, 560-1720, 1720-3160, 3160-8000).
var bandEdges = [5]float64{0, 560, 1720, 3160, 8000}

// Result is the JSON shape served to the client. Bands is an array of
// [bass, midLow, midHigh, treble] samples (each in [0,1]) at `Rate` per second.
type Result struct {
	Bands [][4]float64 `json:"bands"`
	Rate  int          `json:"rate"`
}

// Compute decodes the file to PCM and returns the per-second band timeline.
func Compute(filePath string) (*Result, error) {
	samples, err := decodePCM(filePath)
	if err != nil {
		return nil, err
	}
	return analyze(samples), nil
}

// analyze runs the windowed FFT over raw mono samples ([-1,1]) and reduces to
// the band timeline. Separated from Compute so it can be unit-tested with
// synthetic input (no ffmpeg required).
func analyze(samples []float64) *Result {
	if len(samples) < fftSize {
		return &Result{Bands: [][4]float64{{0, 0, 0, 0}}, Rate: targetBandsPS}
	}

	hann := hannWindow(fftSize)
	binHz := float64(sampleRate) / float64(fftSize)
	binBand := make([]int, fftSize/2)
	for b := 0; b < fftSize/2; b++ {
		binBand[b] = bandFor(float64(b) * binHz)
	}

	re := make([]float64, fftSize)
	im := make([]float64, fftSize)

	// Aggregate FFT windows into buckets of `targetBandsPS` per second.
	windowsPerBucket := float64(sampleRate) / float64(hop) / float64(targetBandsPS)
	if windowsPerBucket < 1 {
		windowsPerBucket = 1
	}
	var timeline [][4]float64
	var cur [4]float64
	var count int
	for pos := 0; pos+fftSize <= len(samples); pos += hop {
		for i := 0; i < fftSize; i++ {
			re[i] = samples[pos+i] * hann[i]
			im[i] = 0
		}
		fft(re, im)
		var bandSum [4]float64
		// Bin 0 is DC (no useful energy); sum magnitudes into bands.
		for b := 1; b < fftSize/2; b++ {
			mag := math.Sqrt(re[b]*re[b] + im[b]*im[b])
			bandSum[binBand[b]] += mag
		}
		for i := 0; i < 4; i++ {
			cur[i] += bandSum[i]
		}
		count++
		if float64(count) >= windowsPerBucket {
			for i := 0; i < 4; i++ {
				cur[i] /= float64(count)
			}
			timeline = append(timeline, cur)
			cur = [4]float64{}
			count = 0
		}
	}
	if count > 0 {
		for i := 0; i < 4; i++ {
			cur[i] /= float64(count)
		}
		timeline = append(timeline, cur)
	}

	// Peak-normalize each band across the track so the loudest moment = 1.0
	// (matches waveform's per-track normalization; gives consistent reactivity
	// regardless of absolute track loudness).
	for i := 0; i < 4; i++ {
		max := 0.0
		for _, bk := range timeline {
			if bk[i] > max {
				max = bk[i]
			}
		}
		if max > 0 {
			for j := range timeline {
				timeline[j][i] /= max
			}
		}
	}

	return &Result{Bands: timeline, Rate: targetBandsPS}
}

func bandFor(hz float64) int {
	for i := 3; i >= 0; i-- {
		if hz >= bandEdges[i] {
			return i
		}
	}
	return 0
}

// decodePCM shells out to ffmpeg for mono 22050 Hz signed-16-bit-LE PCM.
// Runs niced (lowest CPU priority) so this background analysis always yields to
// the foreground playback transcode — the playback-first policy.
func decodePCM(filePath string) ([]float64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := downloads.NicedFfmpegCommandContext(ctx,
		"-i", filePath,
		"-ac", "1",
		"-ar", strconv.Itoa(sampleRate),
		"-f", "s16le",
		"-acodec", "pcm_s16le",
		"-",
	)
	if cmd == nil {
		return nil, nil
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	samples := make([]float64, 0, len(out)/2)
	for i := 0; i+1 < len(out); i += 2 {
		s := int16(binary.LittleEndian.Uint16(out[i : i+2]))
		samples = append(samples, float64(s)/32768.0)
	}
	return samples, nil
}

func hannWindow(n int) []float64 {
	w := make([]float64, n)
	for i := 0; i < n; i++ {
		w[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(n-1))
	}
	return w
}

// fft is an in-place iterative radix-2 Cooley-Tukey FFT. len(re)==len(im),
// and must be a power of two.
func fft(re, im []float64) {
	n := len(re)
	// Bit-reversal permutation.
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			re[i], re[j] = re[j], re[i]
			im[i], im[j] = im[j], im[i]
		}
	}
	for length := 2; length <= n; length <<= 1 {
		half := length >> 1
		ang := -2 * math.Pi / float64(length)
		wr := math.Cos(ang)
		wi := math.Sin(ang)
		for i := 0; i < n; i += length {
			crr, cim := 1.0, 0.0
			for k := 0; k < half; k++ {
				xr := re[i+k]
				xi := im[i+k]
				yr := re[i+k+half]*crr - im[i+k+half]*cim
				yi := re[i+k+half]*cim + im[i+k+half]*crr
				re[i+k] = xr + yr
				im[i+k] = xi + yi
				re[i+k+half] = xr - yr
				im[i+k+half] = xi - yi
				ncrr := crr*wr - cim*wi
				cim = crr*wi + cim*wr
				crr = ncrr
			}
		}
	}
}

// --- caching (mirrors waveform, but with source-mtime invalidation) ---

var (
	bandSem = make(chan struct{}, 1) // cap 1: bands is background work; never compete with playback/transcode
	pendMu  sync.Mutex
	pending = make(map[string]bool)
)

func BandsDir() string { return filepath.Join(store.MusicDir, "images", "bands") }
func BandsPath(trackID string) string {
	return filepath.Join(BandsDir(), trackID+".json")
}

// GetCached returns the cached timeline for trackID. ok is false if the cache
// is missing, corrupt, or stale (older than the source file).
func GetCached(trackID string) (res *Result, ok bool, err error) {
	store.Mu.RLock()
	track, exists := store.Tracks[trackID]
	store.Mu.RUnlock()
	if !exists {
		return nil, false, nil
	}
	srcPath := scanner.ResolveFilePath(track.FilePath)
	srcInfo, err := os.Stat(srcPath)
	if err != nil {
		return nil, false, nil
	}
	cacheInfo, err := os.Stat(BandsPath(trackID))
	if err != nil {
		return nil, false, nil
	}
	// Stale if the cache predates the source (re-tag/replace).
	if cacheInfo.ModTime().Before(srcInfo.ModTime()) {
		return nil, false, nil
	}
	data, err := os.ReadFile(BandsPath(trackID))
	if err != nil {
		return nil, false, nil
	}
	var r Result
	if json.Unmarshal(data, &r) == nil && len(r.Bands) > 0 {
		return &r, true, nil
	}
	return nil, false, nil
}

// GenerateAsync computes and caches the band timeline in the background.
// Dedupes per-track; caps concurrency at bandSem.
func GenerateAsync(trackID string) {
	pendMu.Lock()
	if pending[trackID] {
		pendMu.Unlock()
		return
	}
	pending[trackID] = true
	pendMu.Unlock()

	store.SafeGo("bands", func() {
		defer func() {
			pendMu.Lock()
			delete(pending, trackID)
			pendMu.Unlock()
		}()

		bandSem <- struct{}{}
		defer func() { <-bandSem }()

		store.Mu.RLock()
		track, exists := store.Tracks[trackID]
		store.Mu.RUnlock()
		if !exists {
			return
		}

		fullPath := scanner.ResolveFilePath(track.FilePath)
		res, err := Compute(fullPath)
		if err != nil || res == nil || len(res.Bands) == 0 {
			return
		}

		os.MkdirAll(BandsDir(), 0755)
		jsonData, _ := json.Marshal(res)
		os.WriteFile(BandsPath(trackID), jsonData, 0644)

		log.Printf("[bands] Generated and cached %d buckets for %s", len(res.Bands), trackID)
	})
}
