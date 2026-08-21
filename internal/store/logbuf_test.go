package store

import (
	"bytes"
	"sync"
	"testing"
)

func TestRingBufferConcurrentSnapshots(t *testing.T) {
	rb := NewRingBuffer(1024)
	payload := bytes.Repeat([]byte("x"), 64)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				if _, err := rb.Write(payload); err != nil {
					t.Errorf("Write: %v", err)
					return
				}
				_ = rb.Bytes()
			}
		}()
	}
	wg.Wait()

	if got := len(rb.Bytes()); got > 1024 {
		t.Fatalf("snapshot length = %d, exceeds capacity", got)
	}
}

func TestRingBufferPreservesTailAfterOverflow(t *testing.T) {
	rb := NewRingBuffer(8)
	rb.Write([]byte("abcdefghijklmnop")) // 16 bytes into 8 — keep last 8
	if got := string(rb.Bytes()); got != "ijklmnop" {
		t.Fatalf("after overflow = %q, want %q", got, "ijklmnop")
	}

	rb2 := NewRingBuffer(8)
	rb2.Write([]byte("12345678")) // exact fill, no overflow
	if got := string(rb2.Bytes()); got != "12345678" {
		t.Fatalf("exact fill = %q, want %q", got, "12345678")
	}
}
