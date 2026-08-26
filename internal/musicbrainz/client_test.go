package musicbrainz

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A caller that goes away while queued behind the rate gate must bail out
// promptly instead of holding a place in line, and must not advance the
// gate (no MusicBrainz request was made on its behalf).
func TestReserveMusicBrainzSlotCtxCancelsWhileWaiting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mb-rate")

	// Prime the gate: next allowed reservation is 10s out.
	if _, err := reserveMusicBrainzSlot(path, 10*time.Second); err != nil {
		t.Fatalf("prime reserveMusicBrainzSlot: %v", err)
	}
	dataBefore, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	if _, err := reserveMusicBrainzSlotCtx(ctx, path, 10*time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("cancellation took %v; gate wait ignored ctx", elapsed)
	}

	// Gate file must be untouched: the canceled caller consumed no slot.
	dataAfter, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(dataAfter)) != strings.TrimSpace(string(dataBefore)) {
		t.Fatalf("gate advanced: before=%s after=%s", dataBefore, dataAfter)
	}
}

// Sanity: sleepContext returns nil after the duration when ctx stays live.
func TestSleepContextWaits(t *testing.T) {
	start := time.Now()
	if err := sleepContext(context.Background(), 30*time.Millisecond); err != nil {
		t.Fatalf("sleepContext: %v", err)
	}
	if time.Since(start) < 25*time.Millisecond {
		t.Fatal("sleepContext returned early")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sleepContext(ctx, time.Hour); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
