package auth

import (
	"time"

	"musicapp/internal/store"
)

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
// Expired tokens are deleted; valid ones get a rolling expiry refresh.
// Disabled users are treated as not found.
func lookupSession(token string) *User {
	var userID string
	var expiresAt int64
	err := store.DB.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token=?`, token,
	).Scan(&userID, &expiresAt)
	if err != nil {
		return nil
	}
	if time.Now().Unix() > expiresAt {
		store.DB.Exec(`DELETE FROM sessions WHERE token=?`, token)
		return nil
	}
	u, err := GetUserByID(userID)
	if err != nil || u.Disabled {
		return nil
	}
	store.DB.Exec(`UPDATE sessions SET expires_at=? WHERE token=?`,
		time.Now().Unix()+int64(sessionTTL.Seconds()), token)
	return u
}

func DeleteSession(token string) {
	store.DB.Exec(`DELETE FROM sessions WHERE token=?`, token)
}

func DeleteSessionsForUser(userID string) error {
	_, err := store.DB.Exec(`DELETE FROM sessions WHERE user_id=?`, userID)
	return err
}
