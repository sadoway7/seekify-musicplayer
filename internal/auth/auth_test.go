package auth

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"musicapp/internal/store"
)

// setupTestDB swaps in a fresh temp sqlite with only the auth tables,
// matching the DB-swap pattern in internal/store/dedup_verify_test.go.
func setupTestDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	prev := store.DB
	store.DB = db
	t.Cleanup(func() { store.DB = prev })
	for _, q := range []string{
		`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, email TEXT, disabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
}

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if len(hash) == 0 {
		t.Fatal("empty hash")
	}
	if !VerifyPassword(hash, "correct-horse-battery-staple") {
		t.Error("correct password failed verify")
	}
	if VerifyPassword(hash, "wrong") {
		t.Error("wrong password passed verify")
	}
}

func TestValidateCredentials(t *testing.T) {
	cases := []struct {
		u, p string
		ok   bool
	}{
		{"alice", "password123", true},
		{"ab", "password123", false},  // too short username
		{"a b", "password123", false}, // invalid char
		{"alice@host", "password123", false},
		{"alice", "short", false}, // too short password
	}
	for _, c := range cases {
		err := ValidateCredentials(c.u, c.p)
		if (err == nil) != c.ok {
			t.Errorf("ValidateCredentials(%q,%q) ok=%v want %v (err=%v)", c.u, c.p, err == nil, c.ok, err)
		}
	}
}

func TestSessionLifecycle(t *testing.T) {
	setupTestDB(t)
	u, err := CreateUser("alice", "password123", RoleAdmin, "a@b.c")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	tok, err := CreateSession(u.ID, "1.2.3.4", "test")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if len(tok) != 64 {
		t.Fatalf("token len = %d, want 64", len(tok))
	}
	got := lookupSession(tok)
	if got == nil || got.ID != u.ID {
		t.Fatalf("lookupSession = %v, want alice", got)
	}
	// disabled user → session rejected
	dis := true
	if err := UpdateUser(u.ID, UserUpdate{Disabled: &dis}); err != nil {
		t.Fatal(err)
	}
	if lookupSession(tok) != nil {
		t.Fatal("disabled user's session should be rejected")
	}
	DeleteSession(tok)
}

func TestDeleteLastAdminRefused(t *testing.T) {
	setupTestDB(t)
	a, err := CreateUser("admin1", "password123", RoleAdmin, "")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := DeleteUser(a.ID); err == nil {
		t.Fatal("expected error deleting last admin")
	}
	if _, err := CreateUser("admin2", "password123", RoleAdmin, ""); err != nil {
		t.Fatalf("second admin: %v", err)
	}
	if err := DeleteUser(a.ID); err != nil {
		t.Fatalf("delete should succeed with another admin present: %v", err)
	}
}
