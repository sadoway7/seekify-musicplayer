package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"musicapp/internal/auth"
	"musicapp/internal/store"
)

// SetupStatusHandler → {needsSetup: bool}. Public: lets the SPA show the
// first-run admin setup screen when no users exist yet.
func SetupStatusHandler(w http.ResponseWriter, r *http.Request) {
	n, _ := auth.CountUsers()
	writeJSON(w, map[string]interface{}{"needsSetup": n == 0})
}

// SetupHandler creates the first admin (only when zero users exist), runs the
// one-time legacy-data migration to that admin, and starts a session.
func SetupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	n, _ := auth.CountUsers()
	if n > 0 {
		writeJSONError(w, http.StatusGone, "setup already complete")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Email    string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	u, err := auth.CreateUser(body.Username, body.Password, auth.RoleAdmin, body.Email)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := store.MigrateLegacyDataTo(u.ID); err != nil {
		log.Printf("[setup] legacy migration error: %v", err)
	}
	tok, err := auth.CreateSession(u.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	auth.SetSessionCookie(w, tok)
	writeJSON(w, auth.PublicUser(u))
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	u, err := auth.GetUserByUsername(body.Username)
	if err != nil || u.Disabled || !auth.VerifyPassword(u.PasswordHash, body.Password) {
		writeJSONError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if u.Status != auth.StatusActive {
		writeJSONError(w, http.StatusForbidden, "account pending approval")
		return
	}
	tok, err := auth.CreateSession(u.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	auth.SetSessionCookie(w, tok)
	writeJSON(w, auth.PublicUser(u))
}

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("music_session"); err == nil && c.Value != "" {
		auth.DeleteSession(c.Value)
	}
	auth.ClearSessionCookie(w)
	writeJSON(w, map[string]interface{}{"ok": true})
}

// MeHandler → current user, or {guest:true} for anonymous library browsing.
func MeHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, auth.PublicUser(auth.CurrentUser(r)))
}

func ChangeOwnPasswordHandler(w http.ResponseWriter, r *http.Request) {
	u := auth.CurrentUser(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !auth.VerifyPassword(u.PasswordHash, body.Old) {
		writeJSONError(w, http.StatusUnauthorized, "current password incorrect")
		return
	}
	if err := auth.SetUserPassword(u.ID, body.New); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}
