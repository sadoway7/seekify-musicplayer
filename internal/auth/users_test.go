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

// TestDeleteUserCascadesAllUserData: deleting a user must remove every row
// they own — favorites, blocked tracks, recents, playlists (+ their
// tracks), download jobs, and sessions — in one shot. Previously only the
// users row went away and
// the other tables kept rows forever.
func TestDeleteUserCascadesAllUserData(t *testing.T) {
	setupTestDB(t)
	admin, err := CreateUser("admin1", "password123", RoleAdmin, "")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	other, err := CreateUser("other", "password123", RoleUser, "")
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	u, err := CreateUser("victim", "password123", RoleUser, "")
	if err != nil {
		t.Fatalf("create victim: %v", err)
	}

	mustExec := func(q string, args ...interface{}) {
		t.Helper()
		if _, err := store.DB.Exec(q, args...); err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	mustExec(`INSERT INTO user_favorites(user_id, track_id, added_at) VALUES(?,?,0)`, u.ID, "t1")
	mustExec(`INSERT INTO user_blocked(user_id, track_id, added_at) VALUES(?,?,0)`, u.ID, "t1")
	mustExec(`INSERT INTO user_recent(user_id, track_id, position) VALUES(?,?,0)`, u.ID, "t1")
	mustExec(`INSERT INTO playlists(id, name, created_at, user_id) VALUES('pl-victim','Mine','2026',?)`, u.ID)
	mustExec(`INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES('pl-victim','t1',0)`)
	mustExec(`INSERT INTO download_jobs(id, status, user_id) VALUES('job1','completed',?)`, u.ID)
	if _, err := CreateSession(u.ID, "1.2.3.4", "test"); err != nil {
		t.Fatalf("create session: %v", err)
	}
	// Another user's rows must survive the delete.
	mustExec(`INSERT INTO user_favorites(user_id, track_id, added_at) VALUES(?,?,0)`, other.ID, "t9")
	mustExec(`INSERT INTO playlists(id, name, created_at, user_id) VALUES('pl-other','Theirs','2026',?)`, other.ID)

	if err := DeleteUser(u.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	count := func(q string, args ...interface{}) int {
		t.Helper()
		var n int
		if err := store.DB.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("count %q: %v", q, err)
		}
		return n
	}
	for _, tc := range []struct {
		table string
		n     int
	}{
		{"users", count(`SELECT COUNT(*) FROM users WHERE id=?`, u.ID)},
		{"user_favorites", count(`SELECT COUNT(*) FROM user_favorites WHERE user_id=?`, u.ID)},
		{"user_blocked", count(`SELECT COUNT(*) FROM user_blocked WHERE user_id=?`, u.ID)},
		{"user_recent", count(`SELECT COUNT(*) FROM user_recent WHERE user_id=?`, u.ID)},
		{"playlists", count(`SELECT COUNT(*) FROM playlists WHERE user_id=?`, u.ID)},
		{"playlist_tracks", count(`SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id='pl-victim'`)},
		{"download_jobs", count(`SELECT COUNT(*) FROM download_jobs WHERE user_id=?`, u.ID)},
		{"sessions", count(`SELECT COUNT(*) FROM sessions WHERE user_id=?`, u.ID)},
	} {
		if tc.n != 0 {
			t.Errorf("DeleteUser left %d row(s) in %s, want 0", tc.n, tc.table)
		}
	}
	if n := count(`SELECT COUNT(*) FROM user_favorites WHERE user_id=?`, other.ID); n != 1 {
		t.Errorf("other user's favorites = %d, want 1 (over-delete)", n)
	}
	if n := count(`SELECT COUNT(*) FROM playlists WHERE user_id=?`, other.ID); n != 1 {
		t.Errorf("other user's playlists = %d, want 1 (over-delete)", n)
	}
	if n := count(`SELECT COUNT(*) FROM users WHERE id=?`, admin.ID); n != 1 {
		t.Errorf("admin deleted = %d, want still present", n)
	}
}
