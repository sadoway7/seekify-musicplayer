package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/store"
)

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
