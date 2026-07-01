package handlers

import (
	"encoding/json"
	"musicapp/internal/store"
	"net/http"
)

// WorkersHandler returns the status of all registered background workers.
// GET /api/workers
func WorkersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(store.GetWorkers())
}

// WorkerRunHandler triggers a worker's run function by name.
// POST /api/workers/run?name=<worker_name>
func WorkerRunHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, `{"error":"missing name parameter"}`, http.StatusBadRequest)
		return
	}
	if err := store.TriggerWorker(name); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
