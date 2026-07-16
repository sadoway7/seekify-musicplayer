package store

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTriggerWorkerClaimsBeforeStarting(t *testing.T) {
	const name = "test-concurrent-trigger"
	workersMu.Lock()
	delete(workers, name)
	workersMu.Unlock()
	t.Cleanup(func() {
		workersMu.Lock()
		delete(workers, name)
		workersMu.Unlock()
	})

	release := make(chan struct{})
	var runs atomic.Int32
	RegisterWorker(name, "test", "", func() {
		runs.Add(1)
		<-release
	})

	start := make(chan struct{})
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if TriggerWorker(name) == nil {
				successes.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	close(release)

	if got := successes.Load(); got != 1 {
		t.Fatalf("successful triggers = %d, want 1", got)
	}
	if got := runs.Load(); got != 1 {
		t.Fatalf("worker runs = %d, want 1", got)
	}
}

func TestTriggerWorkerRecoversPanicAndFinishes(t *testing.T) {
	const name = "test-panic-trigger"
	workersMu.Lock()
	delete(workers, name)
	workersMu.Unlock()
	t.Cleanup(func() {
		workersMu.Lock()
		delete(workers, name)
		workersMu.Unlock()
	})

	RegisterWorker(name, "test", "", func() { panic("boom") })
	if err := TriggerWorker(name); err != nil {
		t.Fatalf("TriggerWorker: %v", err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		for _, status := range GetWorkers() {
			if status.Name == name && !status.Running && status.LastRun != "" {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("panicking worker did not return to a finished state")
}
