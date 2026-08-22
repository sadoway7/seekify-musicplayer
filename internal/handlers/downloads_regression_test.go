package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"musicapp/internal/auth"
	"musicapp/internal/downloads"
	"musicapp/internal/store"
)

func setupDownloadsHandlerTest(t *testing.T) (adminReq func(method, path, body string) *http.Request, userID string) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "handler.db"))
	downloads.InitDownloadTables()
	store.SetSetting("download_paused", "true")
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})

	u, err := auth.CreateUser("adminx", "password123", "admin", "")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token, err := auth.CreateSession(u.ID, "test", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	return func(method, path, body string) *http.Request {
		var rdr *strings.Reader
		if body == "" {
			rdr = strings.NewReader("")
		} else {
			rdr = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, rdr)
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		return req
	}, u.ID
}

// callHandler runs a handler through SessionLoad so the session cookie
// resolves to the test user, exactly like the real route chain.
func callHandler(t *testing.T, h http.HandlerFunc, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	auth.SessionLoad(h).ServeHTTP(rec, req)
	return rec
}

func jobStatus(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := store.DB.QueryRow(`SELECT status FROM download_jobs WHERE id=?`, id).Scan(&status); err != nil {
		t.Fatalf("query status for %s: %v", id, err)
	}
	return status
}

func jobExists(t *testing.T, id string) bool {
	t.Helper()
	var one int
	err := store.DB.QueryRow(`SELECT 1 FROM download_jobs WHERE id=?`, id).Scan(&one)
	return err == nil
}

// F5a regression: "Clear Completed" must not delete jobs that are actively
// searching or waiting for a quality selection. Old behavior deleted every
// status outside ('queued','downloading') — killing live searches silently.
func TestQueueClearCompletedSparesActiveJobs(t *testing.T) {
	adminReq, uid := setupDownloadsHandlerTest(t)

	statuses := map[string]string{
		"j-queued":          "queued",
		"j-searching":       "searching",
		"j-downloading":     "downloading",
		"j-needs-selection": "needs_selection",
		"j-completed":       "completed",
		"j-failed":          "failed",
	}
	for id, st := range statuses {
		if _, err := store.DB.Exec(
			`INSERT INTO download_jobs(id, status, user_id, created_at) VALUES (?, ?, ?, ?)`,
			id, st, uid, time.Now().Format(time.RFC3339)); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}

	rec := callHandler(t, QueueClearCompletedHandler, adminReq(http.MethodPost, "/api/queue/clear-completed", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("clear-completed status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	for _, id := range []string{"j-queued", "j-searching", "j-downloading", "j-needs-selection"} {
		if !jobExists(t, id) {
			t.Errorf("active job %s (%s) was deleted by Clear Completed — must survive", id, statuses[id])
		}
	}
	for _, id := range []string{"j-completed", "j-failed"} {
		if jobExists(t, id) {
			t.Errorf("finished job %s (%s) survived Clear Completed — must be deleted", id, statuses[id])
		}
	}
}

// F4 regression: after the user picks a Soulseek candidate, the job row must
// never sit in 'queued' — a queued row is claimable by the generic queue
// driver, which would re-search and auto-pick a different candidate while
// the user's selection downloads (double download). Empty stored candidates
// make the spawned goroutine fail fast without spawning python.
func TestSelectHandlerLeavesSlskJobNeverQueued(t *testing.T) {
	adminReq, uid := setupDownloadsHandlerTest(t)

	if _, err := store.DB.Exec(
		`INSERT INTO download_jobs(id, status, source, user_id, candidates, created_at)
		 VALUES ('j-slsk', 'needs_selection', 'soulseek', ?, '', ?)`,
		uid, time.Now().Format(time.RFC3339)); err != nil {
		t.Fatalf("insert job: %v", err)
	}

	rec := callHandler(t, DownloadJobSelectHandler, adminReq(http.MethodPost, "/api/queue/j-slsk/select", `{"videoId":"1"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("select status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	var resp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status == "queued" {
		t.Fatal("handler responded with status 'queued' — the job is claimable by the queue driver (double-download race)")
	}

	// The spawned selection goroutine must also never park the row back in
	// 'queued': it either downloads or fails. Poll for its terminal state.
	deadline := time.Now().Add(10 * time.Second)
	for {
		st := jobStatus(t, "j-slsk")
		if st == "queued" {
			t.Fatal("job row reached 'queued' after selection — queue driver can double-claim it")
		}
		if st == "failed" || st == "completed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("selection goroutine did not settle within 10s (status=%q)", st)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// F4 old-behavior regression: an invalid selection index must be rejected
// BEFORE any mutation. Old code persisted status='queued' before validating,
// leaving a broken request claimable by the queue driver.
func TestSelectHandlerInvalidIndexLeavesJobIntact(t *testing.T) {
	adminReq, uid := setupDownloadsHandlerTest(t)

	if _, err := store.DB.Exec(
		`INSERT INTO download_jobs(id, status, source, user_id, created_at)
		 VALUES ('j-bad', 'needs_selection', 'soulseek', ?, ?)`,
		uid, time.Now().Format(time.RFC3339)); err != nil {
		t.Fatalf("insert job: %v", err)
	}

	rec := callHandler(t, DownloadJobSelectHandler, adminReq(http.MethodPost, "/api/queue/j-bad/select", `{"videoId":"not-a-number"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("select with invalid index status = %d, want 400", rec.Code)
	}
	if st := jobStatus(t, "j-bad"); st != "needs_selection" {
		t.Fatalf("job status after rejected selection = %q, want needs_selection (must stay user-fixable, never queued)", st)
	}
}
