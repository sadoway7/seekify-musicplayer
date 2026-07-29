package auth

import (
	"time"

	"musicapp/internal/store"
)

const sessionRefreshInterval = 24 * time.Hour

func CreateSession(userID, ip, ua string) (string, error) {
	tok, err := newToken()
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	_, err = store.DB.Exec(
		`INSERT INTO sessions(token, user_id, created_at, expires_at, ip_address, user_agent) VALUES(?,?,?,?,?,?)`,
		tok, userID, now, now+int64(sessionTTL.Seconds()), nullIfEmpty(ip), nullIfEmpty(ua),
	)
	if err != nil {
		return "", err
	}
	return tok, nil
}

// lookupSession validates a token and returns the owning user, or nil.
// Expired tokens are deleted. Valid sessions retain a rolling expiry, but the
// database expiry is refreshed at most once per day instead of on every request.
// Disabled users are treated as not found.
func lookupSession(token string) *User {
	return lookupSessionAt(token, time.Now())
}

func lookupSessionAt(token string, now time.Time) *User {
	var userID string
	var expiresAt int64
	err := store.DB.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token=?`, token,
	).Scan(&userID, &expiresAt)
	if err != nil {
		return nil
	}
	nowUnix := now.Unix()
	if nowUnix > expiresAt {
		store.DB.Exec(`DELETE FROM sessions WHERE token=?`, token)
		return nil
	}
	u, err := GetUserByID(userID)
	if err != nil || u.Disabled {
		return nil
	}
	refreshThreshold := nowUnix + int64((sessionTTL - sessionRefreshInterval).Seconds())
	if expiresAt <= refreshThreshold {
		store.DB.Exec(`UPDATE sessions SET expires_at=? WHERE token=?`,
			nowUnix+int64(sessionTTL.Seconds()), token)
	}
	return u
}

func DeleteSession(token string) {
	store.DB.Exec(`DELETE FROM sessions WHERE token=?`, token)
}

func DeleteSessionsForUser(userID string) error {
	_, err := store.DB.Exec(`DELETE FROM sessions WHERE user_id=?`, userID)
	return err
}

// DeleteSessionsForUserExcept drops all sessions for the user except the one
// matching keepToken. Used by the self-service password-change flow so the
// current device stays logged in while other sessions (e.g. a leaked token on
// another machine) are invalidated.
func DeleteSessionsForUserExcept(userID, keepToken string) error {
	_, err := store.DB.Exec(
		`DELETE FROM sessions WHERE user_id=? AND token<>?`, userID, keepToken)
	return err
}
