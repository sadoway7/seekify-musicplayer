package downloads

import (
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"musicapp/internal/store"
)

func setupRegressionTestDB(t *testing.T) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "regression.db"))
	InitDownloadTables()
	store.SetSetting("download_paused", "true")
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})
}

// F19 regression: the queue must claim the OLDEST queued job first (FIFO).
// Old behavior (ORDER BY created_at DESC) returned the newest job, which
// starved older jobs and downloaded bulk imports in reverse track order.
func TestDbGetQueuedJobsIsFIFO(t *testing.T) {
	setupRegressionTestDB(t)

	base := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	stagger := []struct {
		id    string
		delay time.Duration
	}{
		{"oldest", 0},
		{"middle", 3 * time.Second},
		{"newest", 6 * time.Second},
	}
	for _, s := range stagger {
		if _, err := store.DB.Exec(
			`INSERT INTO download_jobs(id, status, user_id, created_at) VALUES (?, 'queued', 'u1', ?)`,
			s.id, base.Add(s.delay).Format(time.RFC3339)); err != nil {
			t.Fatalf("insert %s: %v", s.id, err)
		}
	}

	jobs, err := DbGetQueuedJobs()
	if err != nil {
		t.Fatalf("DbGetQueuedJobs: %v", err)
	}
	if len(jobs) == 0 {
		t.Fatal("no queued jobs returned")
	}
	if jobs[0].ID != "oldest" {
		t.Fatalf("next claimed job = %q, want %q (queue must be FIFO)", jobs[0].ID, "oldest")
	}
}

// F5b regression: deleting a job must terminate its running subprocess.
// Old behavior left the process running to completion, so a "deleted" job's
// track still landed in the library minutes later.
func TestKillActiveJobTerminatesProcess(t *testing.T) {
	setupRegressionTestDB(t)

	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("no sleep binary on this platform")
	}

	const jobID = "job-kill-test"
	cmd := exec.Command("sleep", "30")
	ConfigureCmdProcessTree(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sleep: %v", err)
	}

	DownloadMu.Lock()
	ActiveJobs[jobID] = cmd
	ActiveJobTime[jobID] = time.Now()
	DownloadMu.Unlock()
	t.Cleanup(func() {
		DownloadMu.Lock()
		delete(ActiveJobs, jobID)
		delete(ActiveJobTime, jobID)
		DownloadMu.Unlock()
	})

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	KillActiveJob(jobID)

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("process exited cleanly (status 0) — it should have been killed")
		}
		// killed as expected
	case <-time.After(5 * time.Second):
		t.Fatal("process still running 5s after KillActiveJob — job delete did not cancel it")
	}

	// A second kill (no such job) must be a safe no-op.
	KillActiveJob("no-such-job")
}
