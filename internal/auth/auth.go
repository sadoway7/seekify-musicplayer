package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"

	sessionCookieName = "music_session"
	sessionTTL        = 30 * 24 * time.Hour
)

// User is the authenticated user. PasswordHash is never JSON-marshalled;
// use PublicUser for API responses.
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	Email        string `json:"email,omitempty"`
	Disabled     bool   `json:"disabled"`
	CreatedAt    int64  `json:"createdAt"`
	PasswordHash string `json:"-"`
}

// PublicUser returns the safe, secret-free shape for API responses. nil → guest.
func PublicUser(u *User) map[string]interface{} {
	if u == nil {
		return map[string]interface{}{"guest": true}
	}
	return map[string]interface{}{
		"id":       u.ID,
		"username": u.Username,
		"role":     u.Role,
		"email":    u.Email,
		"disabled": u.Disabled,
	}
}

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func VerifyPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

var (
	ErrUsernameInvalid  = errors.New("username must be 3-32 chars, using [a-zA-Z0-9_.-]")
	ErrPasswordTooShort = errors.New("password must be at least 8 chars")
)

// ValidateCredentials enforces the trust-boundary rules for signup/admin-create.
func ValidateCredentials(username, password string) error {
	if len(username) < 3 || len(username) > 32 {
		return ErrUsernameInvalid
	}
	for _, r := range username {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '_' || r == '.' || r == '-':
		default:
			return ErrUsernameInvalid
		}
	}
	if len(password) < 8 {
		return ErrPasswordTooShort
	}
	return nil
}

type ctxKey struct{}

// CurrentUser returns the authenticated user for the request, or nil (guest).
func CurrentUser(r *http.Request) *User {
	if v, ok := r.Context().Value(ctxKey{}).(*User); ok {
		return v
	}
	return nil
}

func withUser(r *http.Request, u *User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
}

// RequireUser passes only authenticated users; guests get 401 JSON.
func RequireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if CurrentUser(r) == nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// RequireAdmin passes only role=admin users; everyone else gets 403 JSON.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := CurrentUser(r)
		if u == nil || u.Role != RoleAdmin {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

// SessionLoad is the global middleware: cookie → validate session → set user.
// Wrap the top-level mux so CurrentUser works on every route.
func SessionLoad(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookieName); err == nil && c.Value != "" {
			if u := lookupSession(c.Value); u != nil {
				next.ServeHTTP(w, withUser(r, u))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func SetSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: token,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		MaxAge: int(sessionTTL.Seconds()),
	})
}

func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}
