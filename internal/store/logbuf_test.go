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
