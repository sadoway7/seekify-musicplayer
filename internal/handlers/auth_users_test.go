package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"musicapp/internal/auth"
	"musicapp/internal/store"
)

// authCreateTestUser makes a user directly via the auth package.
func authCreateTestUser(t *testing.T, username, password string) (*auth.User, error) {
	t.Helper()
	return auth.CreateUser(username, password, auth.RoleUser, "")
}

// setupAuthUserTest swaps in a fresh temp DB (full store schema) for
// handler-level auth tests, matching the pattern in downloads_regression_test.go.
func setupAuthUserTest(t *testing.T) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "auth-handler.db"))
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
	})
}

// TestRegisterDuplicateUsername: a duplicate-username registration must
// return a friendly message, never the raw sqlite constraint text (which
// disclosed the schema and confirmed the username exists).
func TestRegisterDuplicateUsername(t *testing.T) {
	setupAuthUserTest(t)
	store.SetSetting("registration_mode", "self_service")

	body := `{"username":"dupuser","password":"password123"}`
	first := httptest.NewRecorder()
	RegisterHandler(first, httptest.NewRequest(http.MethodPost, "/api/register", strings.NewReader(body)))
	if first.Code != http.StatusOK {
		t.Fatalf("first register status = %d, want 200 (body: %s)", first.Code, first.Body.String())
	}

	second := httptest.NewRecorder()
	RegisterHandler(second, httptest.NewRequest(http.MethodPost, "/api/register", strings.NewReader(body)))
	if second.Code != http.StatusBadRequest {
		t.Fatalf("duplicate register status = %d, want 400", second.Code)
	}
	got := second.Body.String()
	for _, leak := range []string{"constraint failed", "UNIQUE", "2067", "sqlite"} {
		if strings.Contains(got, leak) {
			t.Errorf("duplicate register leaks raw DB error (%q in body %q)", leak, got)
		}
	}
	if !strings.Contains(got, "username is already taken") {
		t.Errorf("duplicate register body = %q, want friendly %q", got, "username is already taken")
	}
}

// TestLoginUnknownUserMatchesWrongPassword: an unknown-username login must
// be indistinguishable from a wrong-password login — same status, same body,
// and a bcrypt-class duration (an instant reply reveals the username exists).
func TestLoginUnknownUserMatchesWrongPassword(t *testing.T) {
	setupAuthUserTest(t)
	if _, err := authCreateTestUser(t, "knownuser", "password123"); err != nil {
		t.Fatalf("create user: %v", err)
	}

	login := func(username string) (*httptest.ResponseRecorder, time.Duration) {
		body := `{"username":"` + username + `","password":"totally-wrong-pass"}`
		req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(body))
		rec := httptest.NewRecorder()
		start := time.Now()
		LoginHandler(rec, req)
		return rec, time.Since(start)
	}

	recWrong, durWrong := login("knownuser")
	recUnknown, durUnknown := login("ghost-user")

	if recUnknown.Code != recWrong.Code {
		t.Fatalf("unknown-user status = %d, wrong-password status = %d — must match", recUnknown.Code, recWrong.Code)
	}
	if recUnknown.Body.String() != recWrong.Body.String() {
		t.Fatalf("error bodies differ: unknown=%q wrong-password=%q", recUnknown.Body.String(), recWrong.Body.String())
	}
	// bcrypt dominates the wrong-password path; require the unknown path to
	// burn at least a quarter of it. A DB-miss-only reply is ~100x faster.
	if durUnknown < durWrong/4 {
		t.Fatalf("unknown-username login replied in %v vs %v for wrong-password — timing oracle (username exists)", durUnknown, durWrong)
	}
}
