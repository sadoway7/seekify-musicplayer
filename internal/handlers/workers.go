package handlers

import (
	"musicapp/internal/store"
	"net/http"
)

// WorkersHandler returns the status of all registered background workers.
// GET /api/workers
func WorkersHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, store.GetWorkers())
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
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
