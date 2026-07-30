package normalize

import (
	"math"
	"testing"
)

func TestParseIntegratedLufs(t *testing.T) {
	fixture := `
[Parsed_ebur128_0 @ 0x7f8a] Summary:
  Integrated loudness:
    I:         -16.4 LUFS
    Threshold: -26.5 LUFS
  Loudness range:
    LRA:         7.4 LU
`
	got, err := parseIntegratedLufs(fixture)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if math.Abs(got-(-16.4)) > 0.001 {
		t.Errorf("got %v, want -16.4", got)
	}
}

func TestParseIntegratedLufs_PicksLastSummary(t *testing.T) {
	fixture := "  I:         -20.0 LUFS\nmid\n  I:         -16.4 LUFS\n"
	got, err := parseIntegratedLufs(fixture)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if math.Abs(got-(-16.4)) > 0.001 {
		t.Errorf("got %v, want -16.4 (last value)", got)
	}
}

func TestParseIntegratedLufs_Missing(t *testing.T) {
	if _, err := parseIntegratedLufs(""); err == nil {
		t.Error("expected error for empty input")
	}
	if _, err := parseIntegratedLufs("no value here\n"); err == nil {
		t.Error("expected error for missing I: line")
	}
}

func TestComputeGainDb(t *testing.T) {
	got := computeGainDb(-16.4, -14)
	if math.Abs(got-2.4) > 0.001 {
		t.Errorf("got %v, want +2.4 (boost)", got)
	}
	got = computeGainDb(-10.0, -14)
	if math.Abs(got-(-4.0)) > 0.001 {
		t.Errorf("got %v, want -4.0 (attenuate)", got)
	}
}

func TestComputeGainDb_Clamp(t *testing.T) {
	if got := computeGainDb(-60, -14); got != 12.0 && got != 46.0 {
		// -14 - -60 = 46, clamped to +12
		t.Errorf("quiet clamp: got %v, want +12", got)
	}
	if got := computeGainDb(45, -14); got != -30.0 {
		t.Errorf("loud clamp: got %v, want -30", got)
	}
}
