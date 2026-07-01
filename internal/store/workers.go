package store

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// WorkerStatus tracks the runtime state of a background worker.
type WorkerStatus struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Frequency   string `json:"frequency"`    // human-readable, "" for on-demand
	LastRun     string `json:"lastRun"`      // RFC3339, "" if never
	Running     bool   `json:"running"`
	CanTrigger  bool   `json:"canTrigger"`   // true if "Run Now" is available
	Error       string `json:"error,omitempty"` // last error, if any
}

type workerEntry struct {
	mu     sync.Mutex
	status WorkerStatus
	run    func() // trigger function, nil if not manually runnable
}

var (
	workers   = map[string]*workerEntry{}
	workersMu sync.RWMutex
)

// RegisterWorker adds a worker to the registry. Must be called at init/startup
// before the API is served. run is the function to call for "Run Now" (nil if
// the worker can't be manually triggered).
func RegisterWorker(name, description, frequency string, run func()) {
	workersMu.Lock()
	defer workersMu.Unlock()
	if _, ok := workers[name]; ok {
		return // already registered
	}
	workers[name] = &workerEntry{
		status: WorkerStatus{
			Name:        name,
			Description: description,
			Frequency:   frequency,
		},
		run: run,
	}
}

// WorkerStart marks a worker as running.
func WorkerStart(name string) {
	workersMu.RLock()
	w, ok := workers[name]
	workersMu.RUnlock()
	if !ok {
		return
	}
	w.mu.Lock()
	w.status.Running = true
	w.mu.Unlock()
}

// WorkerDone marks a worker as finished, records timestamp and optional error.
func WorkerDone(name string, err error) {
	workersMu.RLock()
	w, ok := workers[name]
	workersMu.RUnlock()
	if !ok {
		return
	}
	w.mu.Lock()
	w.status.Running = false
	w.status.LastRun = time.Now().Format(time.RFC3339)
	if err != nil {
		w.status.Error = err.Error()
	} else {
		w.status.Error = ""
	}
	w.mu.Unlock()
}

// GetWorkers returns all registered workers sorted by name.
func GetWorkers() []WorkerStatus {
	workersMu.RLock()
	defer workersMu.RUnlock()
	var list []WorkerStatus
	for _, w := range workers {
		w.mu.Lock()
		w.status.CanTrigger = w.run != nil
		list = append(list, w.status)
		w.mu.Unlock()
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].Name < list[j].Name
	})
	return list
}

// TriggerWorker runs a worker's trigger function. Returns error if not found
// or already running.
func TriggerWorker(name string) error {
	workersMu.RLock()
	w, ok := workers[name]
	workersMu.RUnlock()
	if !ok {
		return fmt.Errorf("unknown worker: %s", name)
	}
	if w.run == nil {
		return fmt.Errorf("worker %s cannot be manually triggered", name)
	}
	w.mu.Lock()
	if w.status.Running {
		w.mu.Unlock()
		return fmt.Errorf("worker %s is already running", name)
	}
	w.mu.Unlock()

	go func() {
		WorkerStart(name)
		defer WorkerDone(name, nil)
		w.run()
	}()
	return nil
}
