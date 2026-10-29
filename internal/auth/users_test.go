package auth

import (
	"errors"
	"testing"

	"musicapp/internal/store"
)

// TestIsUniqueUsernameErr pins the narrow match: only the sqlite UNIQUE
// failure on users.username counts; every other error stays generic.
func TestIsUniqueUsernameErr(t *testing.T) {
	setupTestDB(t)
	if _, err := CreateUser("dup", "password123", RoleUser, ""); err != nil {
		t.Fatalf("first create: %v", err)
	}
	// Raw duplicate insert to capture the real modernc error string.
	_, realErr := store.DB.Exec(
		`INSERT INTO users(id, username, password_hash, role, email, disabled, status, created_at) VALUES(?,?,?,?,?,?,?,?)`,
		"other-id", "dup", "hash", RoleUser, nil, 0, StatusActive, 0,
	)
	if realErr == nil {
		t.Fatal("expected raw duplicate insert to fail")
	}
	if !isUniqueUsernameErr(realErr) {
		t.Errorf("isUniqueUsernameErr(real username-UNIQUE error) = false, want true (err: %v)", realErr)
	}

	for _, other := range []error{
		nil,
		errors.New("no such table: users"),
		errors.New("constraint failed: UNIQUE constraint failed: sessions.token (2067)"),
		errors.New("constraint failed: UNIQUE constraint failed: users.id (2067)"),
		errors.New("constraint failed: NOT NULL constraint failed: users.email (1299)"),
	} {
		if isUniqueUsernameErr(other) {
			t.Errorf("isUniqueUsernameErr(%v) = true, want false", other)
		}
	}
}

// TestCreateUserDuplicateUsernameFriendly: the public create path maps the
// duplicate-username constraint to ErrUsernameTaken instead of leaking it.
func TestCreateUserDuplicateUsernameFriendly(t *testing.T) {
	setupTestDB(t)
	if _, err := CreateUser("dup", "password123", RoleUser, ""); err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err := CreateUser("dup", "password123", RoleUser, "")
	if !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("duplicate CreateUser err = %v, want ErrUsernameTaken", err)
	}
}
