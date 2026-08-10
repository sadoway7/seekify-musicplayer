package bands

import (
	"math"
	"testing"
)

// TestFFT_sinePeak verifies the FFT puts a pure tone's energy in the right bin.
// A 1000 Hz sine sampled at 22050 Hz over 1024 samples should peak near bin
// 1000 / (22050/1024) = 46.4 -> bin 46.
func TestFFT_sinePeak(t *testing.T) {
	const f = 1000.0
	n := fftSize
	re := make([]float64, n)
	im := make([]float64, n)
	for i := 0; i < n; i++ {
		re[i] = math.Sin(2 * math.Pi * f * float64(i) / float64(sampleRate))
	}
	fft(re, im)
	peakBin, peakMag := 0, 0.0
	for b := 1; b < n/2; b++ {
		mag := math.Sqrt(re[b]*re[b] + im[b]*im[b])
		if mag > peakMag {
			peakMag = mag
			peakBin = b
		}
	}
	if peakBin < 45 || peakBin > 47 {
		t.Fatalf("1000 Hz sine peaked at bin %d, want 45-47", peakBin)
	}
}

// TestFFT_dcAndNyquist: a DC signal concentrates at bin 0; an alternating
// signal at the Nyquist bin.
func TestFFT_dcAndNyquist(t *testing.T) {
	n := fftSize
	// DC = all ones -> bin 0 is the only nonzero magnitude.
	re := make([]float64, n)
	im := make([]float64, n)
	for i := range re {
		re[i] = 1
	}
	fft(re, im)
	if mag := math.Sqrt(re[1]*re[1]+im[1]*im[1]); mag > 1e-6 {
		t.Fatalf("DC signal leaked into bin 1: mag=%v", mag)
	}
}

func TestBandFor(t *testing.T) {
	cases := []struct {
		hz   float64
		want int
	}{
		{0, 0}, {100, 0}, {559, 0}, // bass: 0-560
		{560, 1}, {1000, 1}, {1719, 1}, // midLow: 560-1720
		{1720, 2}, {2500, 2}, {3159, 2}, // midHigh: 1720-3160
		{3160, 3}, {5000, 3}, {8000, 3}, // treble: 3160-8000
	}
	for _, c := range cases {
		if got := bandFor(c.hz); got != c.want {
			t.Errorf("bandFor(%g) = %d, want %d", c.hz, got, c.want)
		}
	}
}

// TestAnalyze_toneInBand feeds analyze a few seconds of a pure tone and checks
// the dominant band in the timeline matches the tone's frequency band.
func TestAnalyze_toneInBand(t *testing.T) {
	cases := []struct {
		name    string
		freq    float64
		wantBin int // expected dominant band index
	}{
		{"bass_120Hz", 120, 0},
		{"midLow_1000Hz", 1000, 1},
		{"midHigh_2500Hz", 2500, 2},
		{"treble_5000Hz", 5000, 3},
	}
	const durSec = 2.0
	n := int(float64(sampleRate) * durSec)
	for _, c := range cases {
		samples := make([]float64, n)
		for i := 0; i < n; i++ {
			samples[i] = math.Sin(2 * math.Pi * c.freq * float64(i) / float64(sampleRate))
		}
		res := analyze(samples)
		if len(res.Bands) == 0 {
			t.Fatalf("%s: empty timeline", c.name)
		}
		// Average each band across the timeline; the tone's band should dominate.
		var avg [4]float64
		for _, b := range res.Bands {
			for i := 0; i < 4; i++ {
				avg[i] += b[i]
			}
		}
		dom := 0
		for i := 1; i < 4; i++ {
			if avg[i] > avg[dom] {
				dom = i
			}
		}
		if dom != c.wantBin {
			t.Errorf("%s: dominant band = %d (avg=%v), want %d", c.name, dom, avg, c.wantBin)
		}
	}
}

// TestAnalyze_shortInput guards the under-fftSize early return.
func TestAnalyze_shortInput(t *testing.T) {
	res := analyze(make([]float64, 100))
	if len(res.Bands) != 1 {
		t.Fatalf("short input: got %d buckets, want 1", len(res.Bands))
	}
	if res.Rate != targetBandsPS {
		t.Fatalf("rate = %d, want %d", res.Rate, targetBandsPS)
	}
}
